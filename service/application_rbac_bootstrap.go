package service

import (
	"context"
	"fmt"
	"time"

	"github.com/basketikun/infinite-canvas/repository"
)

// InitializeApplicationRBAC synchronizes the Portal directory only before the
// one-time local RBAC bootstrap. Completed installations do not depend on the
// directory service during normal startup.
func InitializeApplicationRBAC(ctx context.Context, initialAdminUIDs []string) error {
	completed, err := repository.AppRBACBootstrapCompleted()
	if err != nil {
		return fmt.Errorf("read application RBAC bootstrap state: %w", err)
	}
	if completed {
		return nil
	}
	users, err := fetchDirectoryUsers(ctx)
	if err != nil {
		return fmt.Errorf("initial Portal directory sync: %w", err)
	}
	if err := repository.BootstrapAppAdminsFromDirectory(portalMembersFromDirectoryUsers(users, time.Now().UTC()), initialAdminUIDs); err != nil {
		return fmt.Errorf("bootstrap application RBAC: %w", err)
	}
	return nil
}
