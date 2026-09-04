# Application-Local RBAC Design

## Goal

Move Infinite Canvas authorization out of Portal role assignment. Portal continues to provide trusted identity, the Portal UID, and application-entry access. Infinite Canvas owns three application roles:

- member: default public-material read and drag access.
- public_assets_manager: may manage public images and folders only through the public-material drawer.
- admin: may use every Infinite Canvas administration capability and manage public materials.

## Authority boundary

Gateway X-Portal-User-Uid remains the immutable identity key. Gateway X-Portal-Roles remains display and audit metadata only; it must never grant Infinite Canvas permissions after this migration.

Portal still decides whether a person may enter the app through app:infinite-canvas:access. Once inside, the application resolves role and capability from its own database on every protected request. Portal role assignment is therefore no longer required for role changes.

## Data model

Create app_member_roles with one explicit non-default role per Portal UID:

| Field | Meaning |
| --- | --- |
| user_uid | Portal UID; primary key. |
| role | admin or public_assets_manager; no row means member. |
| granted_by_uid | UID of the local administrator who last assigned it. |
| created_at, updated_at | Assignment metadata. |

Create an app_rbac_state singleton to record completed bootstrap and serialize role writes. Role mutation locks this state row in the same transaction before counting administrators and writing a role. This prevents concurrent demotions from removing the last administrator.

Do not add app roles to portal_members.roles. That field mirrors Portal directory data and is overwritten during synchronization. Permission resolution requires an enabled synchronized Portal member, so a disabled person has no effective application permissions even if their local assignment remains for later reactivation.

## Bootstrap

Production supplies APP_RBAC_INITIAL_ADMIN_UIDS as a comma-separated list of Portal UIDs. During the first successful startup after migration, the app validates every UID, verifies it is an enabled synchronized member, grants local admin, and records bootstrap completion in one transaction.

Later restarts ignore the bootstrap variable after that marker exists. Thus a local administrator can later demote or revoke the initial user's role without it silently returning. If the initial UIDs are unavailable or invalid, startup fails safely rather than deploying a system with ambiguous authority.

## Authorization and APIs

Add one DB-backed resolver returning:

- appRole
- isAdmin
- canManagePublicAssets

The resolver treats storage failures as errors. Middleware returns a server error for such failures; it never confuses them with ordinary 403 denial.

- Admin routes require local admin.
- The six existing public-material write routes require local admin or public_assets_manager.
- Cross-user private-media access and image-reference checks use local admin, replacing the existing Portal-admin shortcut.
- API session retains raw Portal roles only for display and audit compatibility, and adds appRole. Its existing isAdmin and canManagePublicAssets fields become local-role derived.
- Existing public-material mutation paths remain unchanged.

Local administrators use:

~~~text
PATCH /api/admin/members/:uid/app-role
{ "appRole": "member" | "public_assets_manager" | "admin" }
~~~

The target must be enabled and synchronized. The endpoint is idempotent, audits changes, and returns conflict when a change would remove the final local admin.

## User experience

The existing member-management page gains a compact local-role selector and a separate operation-history link. Portal roles remain display and audit metadata, never authorization. The existing public-material drawer continues using canManagePublicAssets and its fresh, fail-closed session refresh behavior.

Only local admins see and access the administration experience. Local public-assets managers receive no admin navigation or admin API access other than public-material mutation routes.

## Migration and rollout

Replace, rather than layer on top of, the current uncommitted Portal-role public-assets-manager implementation. Remove PORTAL_ADMIN_ROLE and PORTAL_PUBLIC_ASSET_MANAGER_ROLE from Infinite Canvas configuration and documentation. No SSO Portal code change is needed.

Before deployment, confirm the intended initial administrator is enabled in Portal and has application entry access, then set APP_RBAC_INITIAL_ADMIN_UIDS to its exact Portal UID. On the first startup, Infinite Canvas fetches the Portal directory before acquiring the RBAC state lock; under that lock it rechecks bootstrap state and, only if still pending, applies the snapshot and initial local-admin assignments atomically. Verify that user can access member management. After bootstrap, ordinary startups do not synchronize the directory automatically and role changes happen only in Infinite Canvas. Do not import existing portal-public-assets-manager membership automatically.

## Verification

Cover bootstrap, local role persistence across directory synchronization, disabled-user fail-closed behavior, admin and public-material route matrices, last-admin concurrency, session output, member-page behavior, public-drawer gates, and local-admin media access. Run complete Go/Bun/type/build/Compose checks and validate AutoMigrate on supported database engines.
