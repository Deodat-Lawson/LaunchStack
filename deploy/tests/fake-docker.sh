#!/usr/bin/env bash
# A stand-in for `docker`, put first on PATH by run.sh. It never talks to a
# daemon: it appends its argv to $FAKE_DOCKER_LOG (one call per line) and
# answers the handful of calls the CLI reads output from.
#
#   FAKE_DOCKER_LOG                 file the argv lines go to (required)
#   FAKE_DOCKER_STATE               directory for what the shim remembers/receives
#   FAKE_DOCKER_INFO_RC             exit code of `docker info` (daemon reachable?)
#   FAKE_DOCKER_PREFLIGHT_RC        exit code of the deploy-check run
#   FAKE_DOCKER_DOWN=1              `compose ps` lists no containers
#   FAKE_DOCKER_UNHEALTHY_VERSION   the app is unhealthy while .env selects this
#                                   LAUNCHSTACK_VERSION (read at `compose up`)
set -u

log="${FAKE_DOCKER_LOG:?FAKE_DOCKER_LOG is not set}"
state="${FAKE_DOCKER_STATE:-$(dirname "$log")}"
printf '%s\n' "$*" >>"$log"

env_version() { # LAUNCHSTACK_VERSION from an env file
  sed -n 's/^LAUNCHSTACK_VERSION=//p' "$1" 2>/dev/null | tail -n 1
}

case "${1:-}" in
  info) exit "${FAKE_DOCKER_INFO_RC:-0}" ;;
  inspect)
    health="healthy"
    if [ -n "${FAKE_DOCKER_UNHEALTHY_VERSION:-}" ] &&
      [ "$(cat "$state/running-version" 2>/dev/null)" = "$FAKE_DOCKER_UNHEALTHY_VERSION" ]; then
      health="unhealthy"
    fi
    last=""
    for a in "$@"; do last="$a"; done
    case "$*" in
      *compose.service*) printf '%s running %s 0\n' "${last#cid-}" "$health" ;;
      *)
        if [ "$last" = "cid-migrate" ]; then
          printf 'exited none 0\n'
        else
          printf 'running %s 0\n' "$health"
        fi
        ;;
    esac
    exit 0
    ;;
  compose) shift ;;
  *) exit 0 ;;
esac

env_file=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --project-directory | -f) shift 2 ;;
    --env-file)
      env_file="$2"
      shift 2
      ;;
    *) break ;;
  esac
done

sub="${1:-}"
[ "$#" -gt 0 ] && shift
case "$sub" in
  version) printf 'Docker Compose version v2.99.0\n' ;;
  up)
    case " $* " in
      *" db "*) ;;
      *) env_version "$env_file" >"$state/running-version" ;;
    esac
    ;;
  ps)
    [ "${FAKE_DOCKER_DOWN:-0}" = "1" ] && exit 0
    svc=""
    for a in "$@"; do
      case "$a" in -*) ;; *) svc="$a" ;; esac
    done
    if [ -n "$svc" ]; then
      printf 'cid-%s\n' "$svc"
    else
      printf 'cid-app\ncid-db\ncid-migrate\n'
    fi
    ;;
  exec)
    case " $* " in
      *" pg_dumpall "*) printf -- '-- fake pg_dumpall output\nCREATE DATABASE pdr_ai_v2;\n' ;;
      *" tar "*)
        mkdir -p "$state/storage-src"
        [ -f "$state/storage-src/blob.bin" ] || printf 'stored-file-bytes' >"$state/storage-src/blob.bin"
        tar -C "$state/storage-src" -cf - .
        ;;
      *" psql "*) cat >"$state/psql-input" ;;
    esac
    ;;
  run)
    case " $* " in
      *"deploy-check.mjs"*) exit "${FAKE_DOCKER_PREFLIGHT_RC:-0}" ;;
      *" --entrypoint sh "*) cat >"$state/storage-input" ;;
    esac
    ;;
esac
exit 0
