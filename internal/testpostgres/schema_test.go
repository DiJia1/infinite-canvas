package testpostgres

import (
	"database/sql"
	"net/url"
	"os"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestNewSchemaIsolatesAndDropsSchema(t *testing.T) {
	first, err := NewSchema("schema_first")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = first.Close() })

	second, err := NewSchema("schema_second")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = second.Close() })

	firstDB, err := gorm.Open(postgres.Open(first.DSN), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	firstSQLDB, err := firstDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = firstSQLDB.Close() })
	if err := firstDB.Exec("CREATE TABLE test_only_items (id integer primary key)").Error; err != nil {
		t.Fatal(err)
	}

	secondDB, err := gorm.Open(postgres.Open(second.DSN), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	secondSQLDB, err := secondDB.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = secondSQLDB.Close() })
	if secondDB.Migrator().HasTable("test_only_items") {
		t.Fatal("schemas leaked test table")
	}

	if err := firstSQLDB.Close(); err != nil {
		t.Fatal(err)
	}
	if err := secondSQLDB.Close(); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}
	if err := second.Close(); err != nil {
		t.Fatal(err)
	}

	adminDB, err := sql.Open("pgx", os.Getenv("TEST_DATABASE_DSN"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = adminDB.Close() })
	for _, schema := range []*Schema{first, second} {
		schemaName := schemaNameFromDSN(t, schema.DSN)
		var exists bool
		if err := adminDB.QueryRow("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1)", schemaName).Scan(&exists); err != nil {
			t.Fatal(err)
		}
		if exists {
			t.Fatalf("test schema %q was not dropped", schemaName)
		}
	}
}

func TestNewSchemaRequiresTestDatabaseDSN(t *testing.T) {
	t.Setenv("TEST_DATABASE_DSN", "")
	t.Setenv("DATABASE_DSN", "postgres://application_user:application_password@127.0.0.1:5432/infinite_canvas?sslmode=disable")

	_, err := NewSchema("missing_test_dsn")
	if err == nil {
		t.Fatal("NewSchema succeeded without TEST_DATABASE_DSN")
	}
	if !strings.Contains(err.Error(), "TEST_DATABASE_DSN") {
		t.Fatalf("NewSchema error %q does not identify TEST_DATABASE_DSN", err)
	}
}

func schemaNameFromDSN(t *testing.T, dsn string) string {
	t.Helper()
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	schemaName := parsed.Query().Get("search_path")
	if schemaName == "" {
		t.Fatal("schema DSN is missing search_path")
	}
	return schemaName
}
