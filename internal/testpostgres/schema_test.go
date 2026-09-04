package testpostgres

import (
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
	if err := firstDB.Exec("CREATE TABLE test_only_items (id integer primary key)").Error; err != nil {
		t.Fatal(err)
	}

	secondDB, err := gorm.Open(postgres.Open(second.DSN), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if secondDB.Migrator().HasTable("test_only_items") {
		t.Fatal("schemas leaked test table")
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
