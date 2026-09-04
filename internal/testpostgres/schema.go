package testpostgres

import (
	"crypto/rand"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

const testDatabaseName = "infinite_canvas_test"

// Schema owns one temporary PostgreSQL schema in the dedicated test database.
type Schema struct {
	DSN string

	testDatabaseDSN string
	name            string
	mu              sync.Mutex
	closed          bool
}

// NewSchema creates an isolated schema and returns a DSN scoped to it.
func NewSchema(prefix string) (*Schema, error) {
	testDatabaseDSN, err := requiredTestDatabaseDSN()
	if err != nil {
		return nil, err
	}

	name, err := schemaName(prefix)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open("pgx", testDatabaseDSN)
	if err != nil {
		return nil, fmt.Errorf("open TEST_DATABASE_DSN: %w", err)
	}
	if _, err := db.Exec("CREATE SCHEMA " + quoteIdentifier(name)); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("create test schema: %w", err)
	}
	if err := db.Close(); err != nil {
		cleanupDB, cleanupErr := sql.Open("pgx", testDatabaseDSN)
		if cleanupErr == nil {
			_, _ = cleanupDB.Exec("DROP SCHEMA " + quoteIdentifier(name) + " CASCADE")
			_ = cleanupDB.Close()
		}
		return nil, fmt.Errorf("close test schema connection: %w", err)
	}

	parsed, err := url.Parse(testDatabaseDSN)
	if err != nil {
		return nil, fmt.Errorf("parse TEST_DATABASE_DSN: %w", err)
	}
	query := parsed.Query()
	query.Set("search_path", name)
	parsed.RawQuery = query.Encode()

	return &Schema{
		DSN:             parsed.String(),
		testDatabaseDSN: testDatabaseDSN,
		name:            name,
	}, nil
}

// Close drops the temporary schema and all objects it contains.
func (s *Schema) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}

	db, err := sql.Open("pgx", s.testDatabaseDSN)
	if err != nil {
		return fmt.Errorf("open TEST_DATABASE_DSN for schema cleanup: %w", err)
	}
	defer db.Close()

	if _, err := db.Exec("DROP SCHEMA " + quoteIdentifier(s.name) + " CASCADE"); err != nil {
		return fmt.Errorf("drop test schema: %w", err)
	}
	s.closed = true
	return nil
}

func requiredTestDatabaseDSN() (string, error) {
	dsn := os.Getenv("TEST_DATABASE_DSN")
	if dsn == "" {
		return "", fmt.Errorf("TEST_DATABASE_DSN is required")
	}

	parsed, err := url.Parse(dsn)
	if err != nil {
		return "", fmt.Errorf("parse TEST_DATABASE_DSN: %w", err)
	}
	if parsed.Scheme != "postgres" && parsed.Scheme != "postgresql" {
		return "", fmt.Errorf("TEST_DATABASE_DSN must use a PostgreSQL URL")
	}
	if strings.Trim(parsed.Path, "/") != testDatabaseName {
		return "", fmt.Errorf("TEST_DATABASE_DSN must point to %q", testDatabaseName)
	}
	return dsn, nil
}

func schemaName(prefix string) (string, error) {
	suffix := make([]byte, 6)
	if _, err := rand.Read(suffix); err != nil {
		return "", fmt.Errorf("generate test schema suffix: %w", err)
	}

	base := sanitizeIdentifier(prefix)
	if base == "" {
		base = "test"
	}
	unique := strconv.Itoa(os.Getpid()) + "_" + strconv.FormatInt(time.Now().UnixNano(), 10) + "_" + fmt.Sprintf("%x", suffix)
	maxPrefixLength := 63 - len(unique) - 1
	if len(base) > maxPrefixLength {
		base = base[:maxPrefixLength]
	}
	return base + "_" + unique, nil
}

func sanitizeIdentifier(value string) string {
	var builder strings.Builder
	for _, r := range strings.ToLower(value) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteByte('_')
		}
	}
	return builder.String()
}

func quoteIdentifier(identifier string) string {
	return `"` + strings.ReplaceAll(identifier, `"`, `""`) + `"`
}
