# PostgreSQL-Only Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove SQLite and MySQL support from Infinite Canvas so every runtime and database-backed test uses PostgreSQL with no implicit local-file fallback.

**Architecture:** Keep the existing GORM model layer, connection-pool configuration, and PostgreSQL `canvas_projects` primary-key upgrade. Add an isolated PostgreSQL test database path first: CI and local tests use a dedicated `TEST_DATABASE_DSN`, while each package or repository test receives a temporary schema through `search_path`. Once all tests are PostgreSQL-backed, reduce the runtime to the PostgreSQL dialector only and remove obsolete SQLite/MySQL code, dependencies, and operational documentation.

**Tech Stack:** Go 1.25, GORM, PostgreSQL 17, GitHub Actions service containers, Docker Compose, Bun/Next.js.

**Spec:** User-approved PostgreSQL-only direction and repository boundary audit on 2026-09-05.

## Global Constraints

- PostgreSQL is the only supported database after this work; there is no `STORAGE_DRIVER`, SQLite fallback, or MySQL compatibility path.
- `DATABASE_DSN` is required for the application and must identify a PostgreSQL database; a missing or unusable DSN must fail startup rather than create a local database file.
- `TEST_DATABASE_DSN` is required for database-backed Go tests and must never fall back to `DATABASE_DSN`, a developer database, or production.
- Preserve the existing PostgreSQL `canvas_projects` upgrade from legacy primary key `(id)` to `(id, owner_uid)`; it protects already-deployed PostgreSQL databases.
- Do not modify, reset, or discard the existing uncommitted application-local RBAC work. Changes to overlapping files must incorporate those edits intentionally.
- Do not use GORM `AutoMigrate` as a cross-engine data migration. If an active SQLite/MySQL deployment is found, stop code removal and complete the explicit data-migration branch in Task 1 first.
- Historical plans and reports may retain historical references to SQLite/MySQL. Only update current runtime configuration and current operational documentation.

---

## File Structure and Change Boundary

| File | Action | Responsibility after the change |
| --- | --- | --- |
| `internal/testpostgres/schema.go` | Create | Build an isolated PostgreSQL schema DSN from `TEST_DATABASE_DSN`; create and drop test schemas safely. |
| `internal/testpostgres/schema_test.go` | Create | Verify schema DSN isolation and cleanup against the dedicated test database. |
| `docker-compose.postgres.test.yml` | Create | Start an ephemeral local PostgreSQL 17 test database without a persistent development volume. |
| `scripts/test-backend-postgres.sh` | Create | Start the ephemeral test database, run Go tests with `TEST_DATABASE_DSN`, and clean it up. |
| `repository/test_database_test.go` | Modify | Reset and close the repository singleton safely while assigning a unique PostgreSQL schema per repository test. |
| `router/router_test.go` | Modify | Replace the SQLite `TestMain` database with an isolated PostgreSQL schema. |
| `middleware/portal_test.go` | Modify | Replace the SQLite `TestMain` database with an isolated PostgreSQL schema. |
| `service/app_permissions_test.go` | Modify | Replace the SQLite `TestMain` database with an isolated PostgreSQL schema. |
| `repository/media_upload_intent_test.go` | Modify | Use the PostgreSQL test helper instead of `:memory:` SQLite. |
| `repository/image_generation_task_test.go` | Modify | Use the PostgreSQL test helper instead of `:memory:` SQLite. |
| `repository/app_member_role_test.go` | Modify | Use PostgreSQL schemas and assert row-lock serialization without SQLite busy/locked retry logic. |
| `repository/canvas_project_test.go` | Modify | Create a PostgreSQL legacy table and test the retained PostgreSQL primary-key migration; remove MySQL dry-run coverage. |
| `config/config.go` | Modify | Require a PostgreSQL DSN and remove `StorageDriver`. |
| `repository/db.go` | Modify | Open PostgreSQL only; retain connection-pool setup and PostgreSQL legacy primary-key migration. |
| `model/canvas_project.go` | Modify | Retain JSON serialization but remove the MySQL-only `LONGTEXT` type override. |
| `go.mod`, `go.sum` | Modify | Remove SQLite/MySQL drivers and their transitive dependencies through `go mod tidy`. |
| `.github/workflows/docker-image.yml` | Modify | Run Go tests with a healthy PostgreSQL 17 service and `TEST_DATABASE_DSN`. |
| `deployment_config_test.go` | Modify | Assert the CI PostgreSQL test service and the absence of legacy runtime database configuration. |
| `.env.example` | Modify | Document only required PostgreSQL production configuration. |
| `render.yaml` | Delete or modify after Task 1 gate | Remove the obsolete manifest if Render is retired; otherwise make it require an external PostgreSQL DSN and current Portal settings in a separate approved deployment change. |
| `docs/backend-database.md`, `docs/features.md`, `docs/deployment.md`, `docs/pending-test.md` | Modify | Describe PostgreSQL-only support and correct stale deployment statements. |

### Task 0: Protect the existing uncommitted RBAC work before beginning database changes

**Files:**

- Review: every file reported by `git status --short`
- Overlap requiring patch-level staging: `config/config.go`, `repository/db.go`, `.env.example`, `docs/deployment.md`, and database-backed tests

**Interfaces:**

- Consumes: the current application-local RBAC working-tree changes.
- Produces: a reviewable baseline in which PostgreSQL-only commits cannot accidentally revert, stage, or hide RBAC work.

- [ ] **Step 1: Record the current working-tree boundary**

~~~bash
git status --short
git diff -- config/config.go repository/db.go .env.example docs/deployment.md
~~~

Confirm that the existing local RBAC work is either committed as its own reviewed change before this plan starts, or deliberately carried forward with patch-level staging. Do not use `git reset`, `git checkout --`, `git restore`, or a broad `git add .` to make the tree appear clean.

- [ ] **Step 2: Choose a safe commit boundary**

If the RBAC work is ready, commit it separately before Task 1. If it is not ready, continue only with `git add -p` for overlapping files and inspect every staged hunk before each PostgreSQL-only commit:

~~~bash
git add -p config/config.go repository/db.go .env.example docs/deployment.md
git diff --cached --check
git diff --cached
~~~

Expected: each PostgreSQL-only commit contains only the intended database/test/configuration hunks; no RBAC authorization behavior is silently changed.

### Task 1: Confirm active data sources and make the cutover reversible

**Files:**

- Modify only after confirmation: `render.yaml`
- Review: production `.env` on the deployment host, PostgreSQL schema, deployed Render service status, `docs/deployment.md`

**Interfaces:**

- Consumes: the production `DATABASE_DSN` and existing PostgreSQL application schema.
- Produces: a recorded verification that all active environments are PostgreSQL, or an explicit one-time SQLite/MySQL-to-PostgreSQL migration runbook before driver removal.

- [ ] **Step 1: Identify every active runtime before changing code**

Run only read-only checks against each deployed environment and record the result without exposing credentials:

~~~bash
grep -E '^(DATABASE_DSN|STORAGE_DRIVER)=' /program/apps/infinite-canvas/.env | sed -E 's#(://)[^@]+@#\\1***@#'
docker compose --project-name infinite-canvas ps
~~~

The expected production result is a PostgreSQL DSN and no runtime depending on a `.db` file or MySQL server. Check the Render dashboard before touching `render.yaml`; the repository audit shows it is not part of the GitHub/Docker release path and contains obsolete application variables.

- [ ] **Step 2: Make and verify a PostgreSQL recovery point**

Use a privileged production operator account to create a custom-format backup of the Infinite Canvas schema, restore it into an isolated PostgreSQL instance, and compare table counts:

~~~bash
pg_dump --format=custom --schema=infinite_canvas --file=infinite-canvas-pre-postgres-only.dump "$DATABASE_DSN"
pg_restore --clean --if-exists --dbname="$RESTORE_DATABASE_DSN" infinite-canvas-pre-postgres-only.dump
~~~

Do not continue until the restore can start the prior application image against the isolated database and can read canvas projects, media, image tasks, Portal members, and local RBAC rows.

- [ ] **Step 3: Handle the only two possible data-source outcomes**

If every active environment is PostgreSQL, mark the precondition complete and leave the old SQLite/MySQL files untouched as an archive until the new image passes production verification.

If any active SQLite or MySQL database exists, do **not** remove its driver. Create a separate migration change that exports each table, imports into an empty PostgreSQL schema, compares row counts and foreign-key-like references, performs a short write freeze for the final delta, and keeps the source database read-only until post-cutover acceptance. `AutoMigrate` must not be used for this transfer.

- [ ] **Step 4: Decide the obsolete Render manifest explicitly**

If no Render service is active, delete `render.yaml`; it currently points at SQLite and legacy authentication variables and should not remain a misleading deployment option.

If a Render service is active, stop this plan before deletion and create an approved Render-specific deployment update that requires a secret PostgreSQL `DATABASE_DSN`, Portal directory variables, and current `/api/healthz` health checking. Do not substitute a SQLite data-file path.

- [ ] **Step 5: Commit only the preflight documentation decision when applicable**

~~~bash
git add -p docs/deployment.md render.yaml
git commit -m "docs: record PostgreSQL-only deployment prerequisites"
~~~

Skip this commit when the preflight produces no tracked-file change; do not mix production backup artifacts or credentials into Git.

### Task 2: Add an isolated PostgreSQL database test harness before removing SQLite

**Files:**

- Create: `internal/testpostgres/schema.go`
- Create: `internal/testpostgres/schema_test.go`
- Create: `docker-compose.postgres.test.yml`
- Create: `scripts/test-backend-postgres.sh`
- Modify: `.github/workflows/docker-image.yml`
- Modify: `deployment_config_test.go`

**Interfaces:**

- Produces `testpostgres.NewSchema(prefix string) (*testpostgres.Schema, error)`.
- `testpostgres.Schema` exposes `DSN string` and `Close() error`.
- Requires `TEST_DATABASE_DSN` to point at a dedicated `infinite_canvas_test` database, never the application `DATABASE_DSN`.

- [ ] **Step 1: Write the failing isolation test**

Create `internal/testpostgres/schema_test.go` with a test that creates two schemas, writes a table through the first schema DSN, and verifies the second schema cannot see it:

~~~go
func TestNewSchemaIsolatesAndDropsSchema(t *testing.T) {
    first, err := NewSchema("schema_first")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = first.Close() })
    second, err := NewSchema("schema_second")
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = second.Close() })

    firstDB, err := gorm.Open(postgres.Open(first.DSN), &gorm.Config{})
    if err != nil { t.Fatal(err) }
    if err := firstDB.Exec("CREATE TABLE test_only_items (id integer primary key)").Error; err != nil { t.Fatal(err) }

    secondDB, err := gorm.Open(postgres.Open(second.DSN), &gorm.Config{})
    if err != nil { t.Fatal(err) }
    if secondDB.Migrator().HasTable("test_only_items") { t.Fatal("schemas leaked test table") }
}
~~~

Also add a test that `NewSchema` rejects an empty `TEST_DATABASE_DSN`; it must never read `DATABASE_DSN`.

- [ ] **Step 2: Run the new test and prove it is red**

~~~bash
TEST_DATABASE_DSN='postgres://infinite_canvas_test_user:Canvas_Test_2026@127.0.0.1:5433/infinite_canvas_test?sslmode=disable' \
  go test ./internal/testpostgres -count=1
~~~

Expected: compile failure because `internal/testpostgres` does not exist.

- [ ] **Step 3: Implement schema creation and cleanup without production fallback**

Implement `NewSchema` to:

1. Read and require `TEST_DATABASE_DSN`.
2. Generate a PostgreSQL-safe schema name from the supplied prefix, process ID, timestamp, and random suffix using only `[a-z0-9_]`.
3. Connect with the unscoped test DSN, execute `CREATE SCHEMA <quoted-name>`, then return a DSN with `search_path=<schema-name>`.
4. In `Close`, close every GORM/SQL connection opened by the helper before running `DROP SCHEMA <quoted-name> CASCADE` through a fresh administrative test connection.

Use identifier quoting for the generated schema name and URL query encoding for `search_path`; do not concatenate credentials or use a production DSN.

Create `docker-compose.postgres.test.yml` with PostgreSQL 17, a separate `infinite_canvas_test` database/user, host port `5433`, a health check, and no bind-mounted or named persistent data volume:

~~~yaml
services:
  postgres-test:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: infinite_canvas_test
      POSTGRES_USER: infinite_canvas_test_user
      POSTGRES_PASSWORD: Canvas_Test_2026
    ports:
      - "5433:5432"
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U infinite_canvas_test_user -d infinite_canvas_test"]
~~~

Create `scripts/test-backend-postgres.sh` to run `docker compose -f docker-compose.postgres.test.yml up -d --wait`, export exactly the test DSN above, execute `go test "${@:-./...}"`, and use a shell `trap` to run `docker compose -f docker-compose.postgres.test.yml down --volumes` on exit.

- [ ] **Step 4: Add the PostgreSQL CI service before changing production code**

Add this service and environment to the existing `build-and-push` GitHub Actions job:

~~~yaml
services:
  postgres:
    image: postgres:17-alpine
    env:
      POSTGRES_DB: infinite_canvas_test
      POSTGRES_USER: infinite_canvas_test_user
      POSTGRES_PASSWORD: Canvas_Test_2026
    options: >-
      --health-cmd "pg_isready -U infinite_canvas_test_user -d infinite_canvas_test"
      --health-interval 5s --health-timeout 5s --health-retries 12
env:
  TEST_DATABASE_DSN: postgres://infinite_canvas_test_user:Canvas_Test_2026@localhost:5432/infinite_canvas_test?sslmode=disable
~~~

Keep `go test ./...` unchanged so all packages run against PostgreSQL. Update `deployment_config_test.go` to require `postgres:17-alpine`, `TEST_DATABASE_DSN`, and `pg_isready` in the workflow.

- [ ] **Step 5: Verify the harness in local Docker and CI-equivalent mode**

~~~bash
scripts/test-backend-postgres.sh
docker compose -f docker-compose.postgres.test.yml config -q
~~~

Expected: PostgreSQL starts healthy, schemas are created and removed, and the helper never connects without `TEST_DATABASE_DSN`.

- [ ] **Step 6: Commit the test foundation**

~~~bash
git add internal/testpostgres docker-compose.postgres.test.yml scripts/test-backend-postgres.sh \
  .github/workflows/docker-image.yml deployment_config_test.go
git commit -m "test: add isolated PostgreSQL database harness"
~~~

### Task 3: Migrate every database-backed Go test to PostgreSQL semantics

**Files:**

- Modify: `repository/test_database_test.go`
- Modify: `router/router_test.go`
- Modify: `middleware/portal_test.go`
- Modify: `service/app_permissions_test.go`
- Modify: `repository/media_upload_intent_test.go`
- Modify: `repository/image_generation_task_test.go`
- Modify: `repository/app_member_role_test.go`
- Modify: `repository/canvas_project_test.go`

**Interfaces:**

- Consumes: `testpostgres.NewSchema(prefix)` and its scoped `Schema.DSN`.
- Produces: a suite that has no SQLite/MySQL imports, `StorageDriver` assignments, `:memory:` DSNs, or SQLite busy/locked error handling.

- [ ] **Step 1: Replace package-wide SQLite `TestMain` configuration with temporary PostgreSQL schemas**

In `router/router_test.go`, `middleware/portal_test.go`, and `service/app_permissions_test.go`, replace temporary `.db` directories and `StorageDriver: "sqlite"` with one schema created before `m.Run()` and dropped after it:

~~~go
schema, err := testpostgres.NewSchema("router")
if err != nil { panic(err) }
config.Cfg = config.Config{
    DatabaseDSN: schema.DSN,
    MediaStorage: "local",
    MediaLocalDir: directory,
}
code := m.Run()
_ = schema.Close()
os.Exit(code)
~~~

Keep media temporary-directory cleanup separate from database schema cleanup. Do not call `t.Parallel` in these packages because each uses mutable `config.Cfg` and the repository singleton.

- [ ] **Step 2: Convert the repository singleton reset helper to one schema per test**

Change `useRepositoryTestDB` so it receives a PostgreSQL scoped config, closes the previously opened `sql.DB` before resetting `db`, `dbErr`, and `dbOnce`, and performs the same close/reset in `t.Cleanup`. Replace all direct SQLite `config.Config` arguments in media upload intent, image generation, RBAC, and legacy canvas tests with a helper that creates a new `testpostgres.Schema` and supplies `config.Config{DatabaseDSN: schema.DSN}`.

The new helper must create its schema before `repository.DB()` is called and close the repository pool before `Schema.Close()` drops the schema. This order prevents PostgreSQL `DROP SCHEMA` from being held by an idle test connection.

- [ ] **Step 3: Replace dialect-only migration tests with a real PostgreSQL legacy migration test**

Rewrite the legacy canvas setup in `repository/canvas_project_test.go` to execute this PostgreSQL-compatible schema before `DB()` runs:

~~~sql
CREATE TABLE canvas_projects (
  id TEXT PRIMARY KEY,
  owner_uid TEXT,
  title TEXT,
  document TEXT,
  revision INTEGER,
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX idx_canvas_projects_owner_uid ON canvas_projects(owner_uid);
~~~

Then call `DB()` and verify both owners can import the same canvas ID without overwriting one another. Call `migratePostgresCanvasProjectPrimaryKey(database)` a second time and verify it is idempotent. Delete `TestCanvasProjectDocumentUsesMySQLLongTextWithoutNarrowingExistingColumns` rather than replacing it with another dialect-specific test.

- [ ] **Step 4: Make the RBAC concurrency test assert PostgreSQL row-lock behavior directly**

In `repository/app_member_role_test.go`, remove `isSQLiteContentionError`, its `strings` import, and retry-after-busy branch. Keep the existing channels that pause the role demotion while it holds the singleton `app_rbac_state` lock; assert that the competing portal-member disable operation has not returned or counted enabled administrators before release. After release, assert it returns `ErrLastAppAdmin` and leaves the member enabled with the admin role intact.

Set the test config connection pool to at least five open connections so the two transactions and test inspection connection cannot deadlock on a one-connection pool.

- [ ] **Step 5: Prove the PostgreSQL test suite is green before deleting a driver**

~~~bash
scripts/test-backend-postgres.sh ./repository ./router ./middleware ./service -count=1
scripts/test-backend-postgres.sh
~~~

Expected: all database-backed packages pass using PostgreSQL, including legacy primary-key migration and RBAC lock tests.

- [ ] **Step 6: Commit the test migration**

~~~bash
git add repository/test_database_test.go router/router_test.go middleware/portal_test.go \
  service/app_permissions_test.go repository/media_upload_intent_test.go \
  repository/image_generation_task_test.go repository/app_member_role_test.go \
  repository/canvas_project_test.go
git commit -m "test: run database suite on PostgreSQL"
~~~

### Task 4: Remove SQLite/MySQL runtime support while preserving PostgreSQL behavior

**Files:**

- Modify: `config/config.go`
- Modify: `repository/db.go`
- Modify: `model/canvas_project.go`
- Modify: `repository/canvas_project_test.go`
- Modify: `go.mod`
- Modify: `go.sum`

**Interfaces:**

- `config.Config` contains `DatabaseDSN string` but no `StorageDriver`.
- `repository.DB() (*gorm.DB, error)` opens only `postgres.Open(config.Cfg.DatabaseDSN)`.
- `migratePostgresCanvasProjectPrimaryKey(database *gorm.DB) error` remains the only legacy schema upgrade function.

- [ ] **Step 1: Add regression tests for PostgreSQL-only startup and document persistence**

Add tests that configure a scoped PostgreSQL DSN and verify:

~~~go
func TestDBUsesPostgresAndMigratesCanvasProjects(t *testing.T) {
    useRepositoryPostgresTestDB(t)
    database, err := DB()
    if err != nil { t.Fatal(err) }
    if database.Dialector.Name() != "postgres" {
        t.Fatalf("dialector=%q, want postgres", database.Dialector.Name())
    }
}
~~~

Retain a JSON round-trip test for `CanvasProject.Document` through PostgreSQL `AutoMigrate` and repository save/read paths. Its purpose is to prove removal of the MySQL-only data-type method does not alter JSON serialization or the existing PostgreSQL document storage behavior.

- [ ] **Step 2: Run the PostgreSQL regression baseline before removal**

~~~bash
TEST_DATABASE_DSN='postgres://infinite_canvas_test_user:Canvas_Test_2026@127.0.0.1:5433/infinite_canvas_test?sslmode=disable' \
  go test ./repository -run 'TestDBUsesPostgres|TestCanvasProjectDocument' -count=1
~~~

Expected: the PostgreSQL behavior test passes before the cleanup. The next step removes obsolete branches without changing this PostgreSQL contract.

- [ ] **Step 3: Make the runtime fail closed on missing PostgreSQL configuration**

In `config/config.go`, delete `StorageDriver` and change `DatabaseDSN` to a required environment field:

~~~go
DatabaseDSN string `env:"DATABASE_DSN,required"`
~~~

In `repository/db.go`, delete `os`, `path/filepath`, SQLite/MySQL imports, the driver normalization, directory creation, `dialector` switch, `sqliteTableInfo`, `migrateSQLiteCanvasProjectPrimaryKey`, and `migrateMySQLCanvasProjectPrimaryKey`. Open the connection with:

~~~go
db, dbErr = gorm.Open(postgres.Open(config.Cfg.DatabaseDSN), &gorm.Config{})
~~~

Call `migratePostgresCanvasProjectPrimaryKey(db)` immediately before `AutoMigrate`. Preserve the connection-pool configuration and its validation exactly as it is.

- [ ] **Step 4: Remove the MySQL-only document type override**

In `model/canvas_project.go`, keep `CanvasProjectDocument`, `MarshalJSON`, and `UnmarshalJSON`; delete `GormDBDataType` and the `gorm`/`schema` imports used only by it. Do not rename the model field, change its serializer tag, or alter the PostgreSQL database column through a destructive migration.

- [ ] **Step 5: Remove driver modules only after code and tests no longer refer to them**

~~~bash
rg -n -i 'glebarez/sqlite|gorm\.io/driver/mysql|sqlite|mysql|STORAGE_DRIVER' \
  --glob '!docs/superpowers/**' --glob '!docs/pending-test.md' .
go mod tidy
go mod verify
~~~

The search may still return an explicitly preserved historical note in `docs/pending-test.md`; it must return no runtime, test, active configuration, or module references. Inspect `go.mod` and `go.sum` to confirm `github.com/glebarez/sqlite`, `gorm.io/driver/mysql`, `github.com/go-sql-driver/mysql`, and `modernc.org/sqlite` are absent.

- [ ] **Step 6: Run focused backend checks**

~~~bash
scripts/test-backend-postgres.sh
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go vet ./...
go build ./...
~~~

Expected: PostgreSQL is the only compiled dialector and all Go tests pass against the isolated database.

- [ ] **Step 7: Commit the runtime simplification**

~~~bash
git add config/config.go repository/db.go model/canvas_project.go repository/canvas_project_test.go go.mod go.sum
git commit -m "refactor: support PostgreSQL storage only"
~~~

### Task 5: Align active configuration, CI assertions, and documentation

**Files:**

- Modify: `.env.example`
- Modify: `.github/workflows/docker-image.yml`
- Modify: `deployment_config_test.go`
- Modify: `docs/backend-database.md`
- Modify: `docs/features.md`
- Modify: `docs/deployment.md`
- Modify: `docs/pending-test.md`
- Delete or modify: `render.yaml`, according to Task 1 decision

**Interfaces:**

- An operator supplies only `DATABASE_DSN` for app storage and `TEST_DATABASE_DSN` only for tests.
- GitHub Actions runs Go tests against PostgreSQL 17 before building or publishing an image.

- [ ] **Step 1: Write configuration assertions before editing configuration files**

Extend `deployment_config_test.go` with a test that reads `.env.example` and the GitHub workflow:

~~~go
func TestDatabaseConfigurationIsPostgresOnly(t *testing.T) {
    example := readDeploymentFile(t, ".env.example")
    workflow := readDeploymentFile(t, ".github/workflows/docker-image.yml")
    for _, forbidden := range []string{"STORAGE_DRIVER=sqlite", "data/infinite-canvas.db", "gorm.io/driver/mysql"} {
        if strings.Contains(example+workflow, forbidden) { t.Fatalf("found legacy setting %q", forbidden) }
    }
    for _, required := range []string{"DATABASE_DSN=postgres://", "TEST_DATABASE_DSN", "postgres:17-alpine"} {
        if !strings.Contains(example+workflow, required) { t.Fatalf("missing %q", required) }
    }
}
~~~

If Render remains active under Task 1, add a separate assertion that `render.yaml` contains no SQLite DSN and requires `DATABASE_DSN` as a secret. If it is retired and deleted, do not add an assertion for a nonexistent file.

- [ ] **Step 2: Update active examples and current operational documentation**

In `.env.example`, remove `STORAGE_DRIVER` and the SQLite fallback block. Keep a PostgreSQL DSN example that uses the dedicated Infinite Canvas schema and make clear that the production secret value must not be committed.

Update the current documents as follows:

- `docs/backend-database.md`: state PostgreSQL-only, correct its stale table inventory to the current `AutoMigrate` models, and describe the retained composite-primary-key compatibility migration.
- `docs/features.md`: replace the three-engine claim with PostgreSQL-only support.
- `docs/deployment.md`: require `DATABASE_DSN`, state that application-image rollback does not roll back database data/schema, and document the backup/restore preflight.
- `docs/pending-test.md`: remove the incorrect claim that production Compose embeds PostgreSQL; retain genuinely historical notes only when labelled as historical.

Do not rewrite `docs/superpowers/plans/**` or old task reports simply because they record prior SQLite/MySQL support.

- [ ] **Step 3: Validate deployment and documentation configuration**

~~~bash
INFINITE_CANVAS_IMAGE=example.invalid/infinite-canvas:check \
  docker compose --env-file .env.example config -q
docker compose -f docker-compose.postgres.test.yml config -q
scripts/test-backend-postgres.sh
~~~

Expected: the production Compose configuration does not need an embedded SQLite/MySQL service; test Compose remains separate and ephemeral; all Go tests use PostgreSQL.

- [ ] **Step 4: Commit the operational alignment**

~~~bash
git add -p .env.example .github/workflows/docker-image.yml deployment_config_test.go \
  docs/backend-database.md docs/features.md docs/deployment.md docs/pending-test.md \
  docker-compose.postgres.test.yml scripts/test-backend-postgres.sh render.yaml
git commit -m "docs: document PostgreSQL-only storage"
~~~

Only include `render.yaml` in this command when Task 1 selected a tracked Render change.

### Task 6: Verify release safety and perform the production rollout

**Files:**

- Review: `scripts/deploy-production.sh`, production `.env`, deployment logs
- No application code changes expected in this task

**Interfaces:**

- Consumes: the preflight backup, verified PostgreSQL-only image, and an existing PostgreSQL production schema.
- Produces: a production application that starts with PostgreSQL only and a validated fallback path to the prior image against the same PostgreSQL database.

- [ ] **Step 1: Run the complete pre-release verification set**

~~~bash
scripts/test-backend-postgres.sh
GOCACHE=/private/tmp/infinite-canvas-go-build-cache go vet ./...
go build ./...
cd web && bun test && bun run typecheck && bun run build
cd .. && git diff --check
~~~

Also inspect the final diff to confirm no unrelated local RBAC changes were reverted and no secret DSN, backup, or database dump was added.

- [ ] **Step 2: Confirm the newly built image has no removed drivers**

~~~bash
rg -n -i 'glebarez/sqlite|gorm\.io/driver/mysql|go-sql-driver/mysql|modernc\.org/sqlite' go.mod go.sum
docker build -t infinite-canvas:postgres-only-check .
~~~

Expected: the module search produces no matches and the image builds successfully.

- [ ] **Step 3: Deploy with the existing immutable-image procedure**

Deploy only after the production DSN and backup have been verified. Use the existing GitHub Actions deployment path; do not run schema-destructive commands on the production database. The retained PostgreSQL legacy-primary-key migration is idempotent and runs at application startup.

- [ ] **Step 4: Run post-deploy acceptance checks**

Verify, using non-destructive requests and normal browser flows:

1. `/api/healthz` returns healthy.
2. A Portal user can list, create, save, reopen, and share a canvas.
3. A user can upload and read private/public media through the configured storage backend.
4. An image task can be created, polled, and completed.
5. A local admin can list members and change an application role; a regular member remains denied.
6. Application logs contain no SQLite/MySQL driver or migration messages.

- [ ] **Step 5: Use the safe rollback boundary if the application fails**

If the image fails application health or acceptance checks, roll back to the last-known-good image using `scripts/deploy-production.sh`'s existing flow while leaving it pointed at the same PostgreSQL schema. Restore the database backup only in a maintenance window and only after deciding that the deployed writes must be discarded; an image rollback alone does not reverse database data or schema.

- [ ] **Step 6: Commit release-only metadata only if the repository convention requires it**

No source commit is required for a successful deployment. Do not commit production output, Docker data, PostgreSQL dumps, generated local test data, or credentials.

## Coverage Review

- SQLite and MySQL runtime branches are removed in Task 4.
- Every identified SQLite test entry point moves to an isolated PostgreSQL schema in Task 3.
- The SQLite-specific lock retry is replaced with PostgreSQL transaction-lock assertions in Task 3.
- PostgreSQL's existing canvas primary-key migration remains and gains a real PostgreSQL regression test in Task 3.
- CI gets a PostgreSQL service before SQLite support is removed in Task 2.
- Local destructive tests never use the persistent developer compose database because Task 2 creates a separate ephemeral Compose file and script.
- Active configuration, Render disposition, and current documentation are handled in Tasks 1 and 5.
- Production data safety, backup, acceptance, and rollback boundaries are handled in Tasks 1 and 6.

## Execution Order

Implement Tasks 1 through 6 in order. Task 1 is a hard gate: if any active SQLite/MySQL data source or live Render deployment is discovered, resolve that environment explicitly before deleting its supporting code. Do not begin Task 4 until Tasks 2 and 3 prove the full backend test suite passes on PostgreSQL.
