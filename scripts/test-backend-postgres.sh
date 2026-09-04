#!/usr/bin/env bash
set -Eeuo pipefail

compose_file="docker-compose.postgres.test.yml"
cleanup() {
  docker compose -f "$compose_file" down --volumes
}
trap cleanup EXIT

docker compose -f "$compose_file" up -d --wait
export TEST_DATABASE_DSN='postgres://infinite_canvas_test_user:Canvas_Test_2026@127.0.0.1:5433/infinite_canvas_test?sslmode=disable'
go test "${@:-./...}"
