package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAdminSaveSettingsRejectsMalformedJSON(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/admin/settings", strings.NewReader("{"))
	recorder := httptest.NewRecorder()

	AdminSaveSettings(recorder, request)

	var result response
	if err := json.NewDecoder(recorder.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Code != 1 || result.Msg != "系统设置请求无效" {
		t.Fatalf("response = %#v, want invalid settings request", result)
	}
}

func TestAdminSaveSettingsRejectsTrailingJSON(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/admin/settings", strings.NewReader("{}{}"))
	recorder := httptest.NewRecorder()

	AdminSaveSettings(recorder, request)

	var result response
	if err := json.NewDecoder(recorder.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	if result.Code != 1 || result.Msg != "系统设置请求无效" {
		t.Fatalf("response = %#v, want invalid settings request", result)
	}
}

func TestRoleChangeHandlerRejectsMalformedAndTrailingJSON(t *testing.T) {
	for _, body := range []string{"{", `{"appRole":"member"}{}`} {
		request := httptest.NewRequest(http.MethodPatch, "/api/admin/members/target/app-role", strings.NewReader(body))
		recorder := httptest.NewRecorder()

		AdminSetPortalMemberAppRole(recorder, request, "target")

		var result response
		if err := json.NewDecoder(recorder.Body).Decode(&result); err != nil {
			t.Fatal(err)
		}
		if recorder.Code != http.StatusBadRequest || result.Code != 1 || result.Data != nil {
			t.Fatalf("response = status %d, body %#v; want HTTP 400 JSON envelope", recorder.Code, result)
		}
	}
}
