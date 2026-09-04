package service

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/basketikun/infinite-canvas/config"
	"github.com/basketikun/infinite-canvas/model"
	"github.com/basketikun/infinite-canvas/repository"
)

const startupBootstrapAdminUID = "4e504ebb-7c9a-4c65-b5dd-1a2f7f2f8a36"

func resetApplicationRBACStartupState(t *testing.T) {
	t.Helper()
	database, err := repository.DB()
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"app_member_roles", "app_rbac_state", "portal_members"} {
		if err := database.Exec("DELETE FROM " + table).Error; err != nil {
			t.Fatal(err)
		}
	}
	t.Cleanup(func() {
		for _, table := range []string{"app_member_roles", "app_rbac_state", "portal_members"} {
			if err := database.Exec("DELETE FROM " + table).Error; err != nil {
				t.Errorf("clear %s: %v", table, err)
			}
		}
	})
}

func useApplicationRBACStartupDirectory(t *testing.T, handler http.Handler) {
	t.Helper()
	server := httptest.NewServer(handler)
	previous := config.Cfg
	config.Cfg.PortalDirectoryURL = server.URL
	config.Cfg.PortalDirectoryAppKey = "infinite-canvas"
	config.Cfg.PortalDirectorySecret = "directory-secret"
	t.Cleanup(func() {
		server.Close()
		config.Cfg = previous
	})
}

func TestInitializeApplicationRBACSyncsDirectoryBeforeFirstBootstrap(t *testing.T) {
	resetApplicationRBACStartupState(t)
	var requests atomic.Int32
	useApplicationRBACStartupDirectory(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if r.Header.Get("X-Portal-Service-Key") != "infinite-canvas" || r.Header.Get("X-Portal-Service-Secret") != "directory-secret" {
			t.Fatalf("directory headers = %q, %q", r.Header.Get("X-Portal-Service-Key"), r.Header.Get("X-Portal-Service-Secret"))
		}
		_, _ = w.Write([]byte(`{"users":[{"userUid":"` + strings.ToUpper(startupBootstrapAdminUID) + `","displayName":"初始管理员","enabled":true,"roles":["Portal 展示角色"]}]}`))
	}))

	if err := InitializeApplicationRBAC(context.Background(), []string{startupBootstrapAdminUID}); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 1 {
		t.Fatalf("directory requests = %d, want 1", requests.Load())
	}
	completed, err := repository.AppRBACBootstrapCompleted()
	if err != nil || !completed {
		t.Fatalf("bootstrap completed = %t, err=%v", completed, err)
	}
	role, err := repository.ResolveAppRole(startupBootstrapAdminUID)
	if err != nil || role != model.AppRoleAdmin {
		t.Fatalf("bootstrap role = %q, err=%v", role, err)
	}
}

func TestInitializeApplicationRBACSkipsSnapshotFetchedBeforeAnotherInitializerCompletes(t *testing.T) {
	resetApplicationRBACStartupState(t)
	if err := repository.UpsertPortalMembers([]model.PortalMember{{
		UserUID: startupBootstrapAdminUID, DisplayName: "当前管理员", Enabled: true, Roles: []string{"当前展示角色"},
	}}); err != nil {
		t.Fatal(err)
	}
	requestStarted := make(chan struct{})
	releaseResponse := make(chan struct{})
	var releaseOnce sync.Once
	useApplicationRBACStartupDirectory(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(requestStarted)
		<-releaseResponse
		_, _ = w.Write([]byte(`{"users":[{"userUid":"` + startupBootstrapAdminUID + `","displayName":"过期目录快照","enabled":false,"roles":["过期展示角色"]}]}`))
	}))

	result := make(chan error, 1)
	go func() {
		result <- InitializeApplicationRBAC(context.Background(), []string{startupBootstrapAdminUID})
	}()
	<-requestStarted
	if err := repository.BootstrapAppAdmins([]string{startupBootstrapAdminUID}); err != nil {
		t.Fatal(err)
	}
	releaseOnce.Do(func() { close(releaseResponse) })
	if err := <-result; err != nil {
		t.Fatal(err)
	}

	member, found, err := repository.GetPortalMember(startupBootstrapAdminUID)
	if err != nil || !found || !member.Enabled || member.DisplayName != "当前管理员" || len(member.Roles) != 1 || member.Roles[0] != "当前展示角色" {
		t.Fatalf("member after stale snapshot = %+v, found=%t, err=%v", member, found, err)
	}
}

func TestInitializeApplicationRBACSkipsDirectoryAfterBootstrap(t *testing.T) {
	resetApplicationRBACStartupState(t)
	if err := repository.UpsertPortalMembers([]model.PortalMember{{
		UserUID: startupBootstrapAdminUID, DisplayName: "已初始化管理员", Enabled: true, Roles: []string{},
	}}); err != nil {
		t.Fatal(err)
	}
	if err := repository.BootstrapAppAdmins([]string{startupBootstrapAdminUID}); err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	useApplicationRBACStartupDirectory(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))

	if err := InitializeApplicationRBAC(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if requests.Load() != 0 {
		t.Fatalf("directory requests after completed bootstrap = %d, want 0", requests.Load())
	}
}

func TestInitializeApplicationRBACStopsWhenFirstDirectorySyncFails(t *testing.T) {
	resetApplicationRBACStartupState(t)
	useApplicationRBACStartupDirectory(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))

	if err := InitializeApplicationRBAC(context.Background(), []string{startupBootstrapAdminUID}); err == nil {
		t.Fatal("initialization accepted a failed directory sync")
	}
	completed, err := repository.AppRBACBootstrapCompleted()
	if err != nil || completed {
		t.Fatalf("bootstrap completed after failed sync = %t, err=%v", completed, err)
	}
}
