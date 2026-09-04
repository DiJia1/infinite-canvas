# Application-Local RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make Infinite Canvas own member, public_assets_manager, and admin roles while Portal supplies only identity and application-entry access.

**Architecture:** Persist explicit non-default roles in a local role table keyed by Portal UID; no row means member. Resolve every protected application capability from that table and the synchronized member enabled state, never from Gateway role headers. Bootstrap initial local administrators once from an explicit deployment variable, then let local administrators manage roles in the existing member page.

**Tech Stack:** Go, Gin, GORM with SQLite/MySQL/PostgreSQL, Next.js/React, TanStack Query, Ant Design, Bun.

**Spec:** docs/superpowers/specs/2026-09-04-application-local-rbac-design.md

## Global Constraints

- Portal Gateway remains the only trusted source for a user UID and application-entry access. Never accept UID or role from a request payload.
- After bootstrap, Gateway role headers, PORTAL_ADMIN_ROLE, and PORTAL_PUBLIC_ASSET_MANAGER_ROLE must not grant Infinite Canvas privileges.
- Keep exactly three effective roles: implicit member, public_assets_manager, and admin.
- Public members retain existing public-material browse, preview, and drag behavior.
- Preserve the existing six public-material mutation URLs.
- Permission lookup failures fail closed with a server error, not a false 403.
- Do not modify SSO Portal or create a generic customizable role editor.
- The current uncommitted Portal-role public-assets-manager implementation is replaced, not stacked with a second authority source.

---

### Task 1: Add persistent local roles and one-time safe bootstrap

**Files:**

- Create: model/app_member_role.go
- Create: repository/app_member_role.go
- Create: repository/app_member_role_test.go
- Modify: repository/db.go
- Modify: main.go
- Modify: config/config.go
- Modify: .env.example

**Interfaces:**

- Produces model.AppRole with AppRoleMember, AppRolePublicAssetsManager, and AppRoleAdmin.
- Produces repository.ResolveAppRole(userUID string) (model.AppRole, error).
- Produces repository.SetAppRole(userUID string, role model.AppRole, grantedByUID string) error.
- Produces repository.BootstrapAppAdmins(initialUIDs []string) error.

- [ ] **Step 1: Write repository tests before adding the schema**

~~~go
func TestResolveAppRoleDefaultsToMember(t *testing.T) {
    role, err := ResolveAppRole("member-uid")
    if err != nil || role != model.AppRoleMember {
        t.Fatalf("role=%q err=%v", role, err)
    }
}

func TestBootstrapAppAdminsRunsOnlyOnce(t *testing.T) {
    saveEnabledPortalMember(t, "initial-admin")
    if err := BootstrapAppAdmins([]string{"initial-admin"}); err != nil { t.Fatal(err) }
    if err := SetAppRole("initial-admin", model.AppRoleMember, "other-admin"); err != nil { t.Fatal(err) }
    if err := BootstrapAppAdmins([]string{"initial-admin"}); err != nil { t.Fatal(err) }
    role, _ := ResolveAppRole("initial-admin")
    if role != model.AppRoleMember { t.Fatalf("bootstrap reassigned %q", role) }
}
~~~

Add a test that concurrent attempts to demote the only two local administrators cannot leave zero administrator assignments.

- [ ] **Step 2: Prove the new tests are red**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./repository -run 'TestResolveAppRole|TestBootstrapAppAdmins|TestLastAdmin' -count=1
~~~

Expected: failure because neither the local role model nor repository operations exist.

- [ ] **Step 3: Implement the local models and repository transaction**

Add app_member_roles with UserUID as primary key, Role, GrantedByUID, CreatedAt, and UpdatedAt. Store only admin and public_assets_manager rows; delete the row for member.

Add app_rbac_state with a singleton primary key, BootstrapCompletedAt, and UpdatedAt. Register both in repository.DB AutoMigrate.

Add APP_RBAC_INITIAL_ADMIN_UIDS to config. Parse it as comma-separated UUIDs. In main.go, call BootstrapAppAdmins immediately after the existing database-opening legacy-media promotion and before workers or the HTTP router start. In one transaction, create or lock the singleton, exit when bootstrap has completed, require each configured initial UID to be an enabled portal_members record, upsert its local admin role, then set BootstrapCompletedAt. Startup must return a clear error when the first bootstrap has no configured UID or references an unsynchronized/disabled UID.

At the beginning of every role mutation transaction, update or lock the singleton row before counting admin records. Count explicit admin assignments after the lock. Reject a mutation from admin to another role when that count is one.

- [ ] **Step 4: Prove the repository tests are green**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./repository -run 'TestResolveAppRole|TestBootstrapAppAdmins|TestLastAdmin' -count=1
~~~

Expected: PASS.

- [ ] **Step 5: Commit this isolated persistence change**

~~~bash
git add model/app_member_role.go repository/app_member_role.go repository/app_member_role_test.go repository/db.go main.go config/config.go .env.example
git commit -m "feat: persist application-local roles"
~~~

### Task 2: Resolve permissions locally and replace every Portal-role authorization shortcut

**Files:**

- Create: service/app_permissions.go
- Create: service/app_permissions_test.go
- Modify: service/context.go
- Modify: middleware/portal.go
- Modify: middleware/portal_test.go
- Modify: router/router.go
- Modify: handler/auth.go
- Modify: handler/media.go
- Modify: service/media.go
- Modify: service/image_task_media_references.go
- Modify: service/media_test.go
- Modify: router/router_test.go

**Interfaces:**

- Produces service.AppPermissions containing AppRole, IsAdmin, and CanManagePublicAssets.
- Produces service.ResolveAppPermissions(ctx, PortalUser) (AppPermissions, error).
- Produces RequireAppAdmin and RequirePublicAssetManager middleware.

- [ ] **Step 1: Write authority-matrix tests first**

~~~go
func TestGatewayAdminRoleAloneDoesNotGrantLocalAdmin(t *testing.T) {
    response := requestWithPortalHeaders(http.MethodGet, "/api/admin/me", "member", "portal-admin")
    if response.Code != http.StatusForbidden { t.Fatalf("status=%d", response.Code) }
}

func TestLocalPublicAssetsManagerWritesOnlyPublicAssets(t *testing.T) {
    grantAppRole("asset-manager", model.AppRolePublicAssetsManager)
    assertStatus(t, requestAs("asset-manager", http.MethodPost, "/api/admin/public-folders"), http.StatusOK)
    assertStatus(t, requestAs("asset-manager", http.MethodGet, "/api/admin/settings"), http.StatusForbidden)
}
~~~

Cover local admin, public_assets_manager, member, disabled member, old Gateway-only role, session response, all six public-material write routes, and cross-user private-media access by a local admin.

- [ ] **Step 2: Run focused authority tests and observe failure**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./middleware ./service ./router -run 'TestGatewayAdminRole|TestLocalPublicAssetsManager|TestLocalAdminMedia' -count=1
~~~

Expected: failure because the current helpers still inspect Portal roles.

- [ ] **Step 3: Implement one DB-backed resolver and update every caller**

Implement ResolveAppPermissions so it resolves a local role record and requires the Portal member to be enabled. A missing role record resolves to member. Do not inspect PortalUser.Roles for authorization.

Middleware must distinguish a backend lookup failure from ordinary denial:

~~~go
permissions, err := service.ResolveAppPermissions(c.Request.Context(), user)
if err != nil {
    c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"code": 1, "data": nil, "msg": "权限检查失败"})
    return
}
if !permissions.IsAdmin {
    c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 1, "data": nil, "msg": "未登录或权限不足"})
    return
}
~~~

Replace the existing admin group middleware and public-material mutation middleware in router/router.go while leaving route paths unchanged. Change service media access and image task media reference checks to accept context and use local admin capability instead of a Portal-admin role.

Make handler/media.go PortalSession return local appRole, isAdmin, and canManagePublicAssets while retaining raw Portal roles nested under user for compatibility/audit. Preserve Cache-Control: no-store. Make AdminCurrent represent a local admin only.

- [ ] **Step 4: Run focused authority tests and prove they pass**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./middleware ./service ./router -run 'TestGatewayAdminRole|TestLocalPublicAssetsManager|TestLocalAdminMedia' -count=1
~~~

Expected: PASS.

- [ ] **Step 5: Commit the authorization boundary**

~~~bash
git add service/app_permissions.go service/app_permissions_test.go service/context.go middleware/portal.go middleware/portal_test.go router/router.go handler/auth.go handler/media.go service/media.go service/image_task_media_references.go service/media_test.go router/router_test.go
git commit -m "feat: authorize canvas roles locally"
~~~

### Task 3: Add an admin-only role-assignment API and audit trail

**Files:**

- Create: service/app_member_roles.go
- Create: service/app_member_roles_test.go
- Modify: model/portal_member.go
- Modify: repository/app_member_role.go
- Modify: service/portal_directory.go
- Modify: handler/settings.go
- Modify: router/router.go
- Modify: router/router_test.go
- Modify: handler/settings_test.go

**Interfaces:**

- Extends member responses with appRole without changing Portal Roles.
- Produces repository.ListAppRoles(userUIDs []string) (map[string]model.AppRole, error) so a paginated member list does not perform one role query per row.
- Produces PATCH /api/admin/members/:uid/app-role.
- Request body: { "appRole": "member" | "public_assets_manager" | "admin" }.
- Returns the changed member record including appRole.

- [ ] **Step 1: Write failing handler/service tests**

~~~go
func TestAdminSetsApplicationRoleAndAuditsIt(t *testing.T) {
    response := requestAsAdmin(http.MethodPatch, "/api/admin/members/target/app-role", `{"appRole":"public_assets_manager"}`)
    if response.Code != http.StatusOK { t.Fatalf("status=%d body=%s", response.Code, response.Body.String()) }
    assertOperation(t, "member_app_role_change", "target")
}

func TestRoleChangeRejectsDisabledTargetAndLastAdminDemotion(t *testing.T) {
    assertStatus(t, requestAsAdmin(http.MethodPatch, "/api/admin/members/disabled/app-role", `{"appRole":"admin"}`), http.StatusBadRequest)
    assertStatus(t, requestAsAdmin(http.MethodPatch, "/api/admin/members/only-admin/app-role", `{"appRole":"member"}`), http.StatusConflict)
}
~~~

Cover invalid role values, non-admin caller, repeated idempotent assignment, sync preserving local roles, and public-assets manager access to this endpoint being forbidden.

- [ ] **Step 2: Run targeted tests and observe failure**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./handler ./router ./service -run 'TestAdminSetsApplicationRole|TestRoleChange|TestDirectorySyncPreservesAppRole' -count=1
~~~

Expected: failure because no role-assignment API exists.

- [ ] **Step 3: Implement exact-role assignment**

Add AppRole only to the member list DTO. Keep the Portal-synced Roles field as read-only metadata. After the existing paginated member query, load that page's assignments with one ListAppRoles call and attach the resulting role map; do not introduce N+1 role lookups.

Validate the static three-role allowlist. Require an enabled, synchronized target. In one role-state transaction, assign admin or public_assets_manager by upsert; convert to member by deleting the explicit row; reject removing the final admin with a stable 409. Record a member_app_role_change operation with actor taken only from Portal context and target data loaded from the member record.

Directory synchronization must only change Portal identity fields and never delete or overwrite app_member_roles.

- [ ] **Step 4: Run targeted role API tests and prove they pass**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./handler ./router ./service -run 'TestAdminSetsApplicationRole|TestRoleChange|TestDirectorySyncPreservesAppRole' -count=1
~~~

Expected: PASS.

- [ ] **Step 5: Commit the role API**

~~~bash
git add service/app_member_roles.go service/app_member_roles_test.go model/portal_member.go repository/app_member_role.go service/portal_directory.go handler/settings.go router/router.go router/router_test.go handler/settings_test.go
git commit -m "feat: let admins assign canvas roles"
~~~

### Task 4: Add local-role controls to member management and preserve drawer behavior

**Files:**

- Modify: web/src/services/api/members.ts
- Create: web/src/services/api/members.test.ts
- Modify: web/src/app/(admin)/admin/members/page.tsx
- Create: web/src/app/(admin)/admin/members/page.test.ts
- Modify: web/src/services/api/session.ts
- Modify: web/src/components/layout/app-top-nav.tsx
- Modify: web/src/stores/use-admin-store.ts only if local admin response types change
- Modify: web/src/app/(user)/canvas/components/public-image-drawer.test.ts

**Interfaces:**

- PortalMember receives appRole.
- Produces updatePortalMemberAppRole(userUID, appRole).
- Existing PortalSession isAdmin and canManagePublicAssets remain the only UI capability gates.

- [ ] **Step 1: Write failing client tests**

~~~ts
test("member API sends one validated local role update", async () => {
    assert.match(source, /apiPatch<PortalMember>\(.+\/api\/admin\/members.+app-role/);
});

test("member rows separate role controls from operation history navigation", async () => {
    assert.match(source, /公共素材管理员/);
    assert.match(source, /查看操作记录/);
    assert.doesNotMatch(source, /<Link[^>]*>[^]*<Select/);
});
~~~

Cover success invalidating portal-members, failure preserving server-rendered role, manager session not showing admin navigation, and the public drawer remaining capability-driven rather than inspecting raw role names.

- [ ] **Step 2: Run focused client tests and observe failure**

Run:

~~~bash
cd web && bun test src/services/api/members.test.ts 'src/app/(admin)/admin/members/page.test.ts' 'src/app/(user)/canvas/components/public-image-drawer.test.ts'
~~~

Expected: failure because the role client and controls do not exist.

- [ ] **Step 3: Implement compact assignment controls**

Extend the members API type and add a typed PATCH client. Change each MemberRow so it is not one wrapping Link: use a normal row, a compact Ant Design Select with member, public_assets_manager, and admin labels, plus a separate operation-history Link.

Disable the selector only for the row mutation in flight. On success invalidate portal-members; on failure show the backend error and leave the query result unchanged. Portal roles stay visible only as informational tags.

Do not change the public-material drawer's fresh session capability hook. It should continue to use only canManagePublicAssets. Navigation keeps using local isAdmin.

- [ ] **Step 4: Run focused client tests and prove they pass**

Run:

~~~bash
cd web && bun test src/services/api/members.test.ts 'src/app/(admin)/admin/members/page.test.ts' 'src/app/(user)/canvas/components/public-image-drawer.test.ts'
~~~

Expected: PASS.

- [ ] **Step 5: Commit the member UI**

~~~bash
git add web/src/services/api/members.ts web/src/services/api/members.test.ts 'web/src/app/(admin)/admin/members/page.tsx' 'web/src/app/(admin)/admin/members/page.test.ts' web/src/services/api/session.ts web/src/components/layout/app-top-nav.tsx web/src/stores/use-admin-store.ts 'web/src/app/(user)/canvas/components/public-image-drawer.test.ts'
git commit -m "feat: manage canvas roles from members page"
~~~

### Task 5: Remove old Portal role configuration and validate the production rollout

**Files:**

- Modify: .env.example
- Modify: config/config.go
- Modify: docs/deployment.md
- Modify: docs/features.md
- Modify: docs/backend-database.md
- Modify: router/router_test.go
- Modify: middleware/portal_test.go
- Modify: service/media_test.go
- Modify: web/src/components/layout/app-top-nav.test.ts
- Modify: web/src/components/layout/admin-navigation.test.ts

**Interfaces:**

- Removes PORTAL_ADMIN_ROLE and PORTAL_PUBLIC_ASSET_MANAGER_ROLE as Infinite Canvas authority inputs.
- Documents APP_RBAC_INITIAL_ADMIN_UIDS as one-time bootstrap configuration.

- [ ] **Step 1: Write final regression tests for legacy role isolation**

~~~go
func TestLegacyGatewayRolesNeverGrantLocalPrivileges(t *testing.T) {
    // Requests carrying only portal-admin or portal-public-assets-manager
    // must resolve as member after bootstrap.
}
~~~

Add client checks that neither admin navigation nor public-drawer write gates reference literal Portal role names.

- [ ] **Step 2: Run targeted migration checks and observe failure**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./router ./middleware ./service -run TestLegacyGatewayRolesNeverGrantLocalPrivileges -count=1
cd web && bun test src/components/layout/app-top-nav.test.ts
~~~

Expected: failure until legacy authority is removed.

- [ ] **Step 3: Remove legacy authority and update operating instructions**

Delete the two Portal-role config fields and helper logic. Keep identity header parsing and audit metadata.

Document this release order:

1. Synchronize the initial administrator as an enabled Portal member.
2. Set APP_RBAC_INITIAL_ADMIN_UIDS to one or more exact Portal UIDs.
3. Deploy; verify that user can enter /admin/members.
4. Assign at least one additional local admin before changing the bootstrap administrator.
5. Remove the bootstrap variable after the completed marker has been recorded.
6. Manage all future Infinite Canvas roles inside the member page; do not assign Portal admin or public-material roles for this app.

Do not import prior portal-public-assets-manager membership automatically.

- [ ] **Step 4: Run the full verification gate**

Run:

~~~bash
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go test ./... -count=1
cd web && bun test
cd web && bun run typecheck
cd web && bun run build
INFINITE_CANVAS_IMAGE=example.invalid/infinite-canvas:check docker compose --env-file .env.example config -q
git diff --check
~~~

Expected: each command exits 0. Verify AutoMigrate behavior with configured PostgreSQL and MySQL test databases if available; SQLite is covered by the repository suite.

- [ ] **Step 5: Commit documentation and final tests**

~~~bash
git add .env.example config/config.go docs/deployment.md docs/features.md docs/backend-database.md router/router_test.go middleware/portal_test.go service/media_test.go web/src/components/layout/app-top-nav.test.ts web/src/components/layout/admin-navigation.test.ts
git commit -m "docs: document application-local role rollout"
~~~

## Acceptance Checklist

- [ ] Initial configured UIDs become local admins exactly once.
- [ ] Gateway Portal roles alone do not grant local admin or public-material write access.
- [ ] Local admin has all administration and public-material permissions.
- [ ] Local public_assets_manager can manage public images/folders but receives 403 on every other admin endpoint.
- [ ] Member can browse, preview, and drag public materials but cannot mutate them.
- [ ] An application-role revocation takes effect on the next request and after reopening the public-material drawer.
- [ ] Directory sync does not overwrite local assignments; disabled members have no effective local role.
- [ ] Concurrent role changes cannot leave zero local administrators.
