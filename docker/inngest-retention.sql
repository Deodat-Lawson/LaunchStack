-- Prunes old run history from the self-hosted Inngest server's database.
--
-- `inngest start` never deletes events, runs or traces from Postgres, and the
-- worker's crons alone start ~62,000 runs a month (brand publishing runs every
-- minute), at roughly 30 KB of history each — about 2 GB a month if never
-- pruned. This keeps the last :days days (default 7) of history, which is
-- what the dashboard shows. Run it daily from the VM's crontab, next to the
-- backup (docs/runbooks/azure-lean-deploy.md, "Background jobs"):
--
--   docker exec -i pdr_ai_v2-postgres psql -U postgres -d inngest -v days=7 \
--     < ~/LaunchStack/docker/inngest-retention.sql
--
-- Only history tables are touched. apps and functions (the synced
-- configuration) and the schema bookkeeping are left alone, and live run
-- state is in Redis, not here. Written against the schema of the pinned
-- image (inngest/inngest:v1.46.0); recheck the table list when bumping it.
-- Timestamps without a time zone are stored in UTC.

\set ON_ERROR_STOP on
\if :{?days}
\else
  \set days 7
\endif

SELECT (now() AT TIME ZONE 'UTC') - make_interval(days => :days) AS cutoff \gset

BEGIN;
DELETE FROM events            WHERE received_at    < :'cutoff';
DELETE FROM event_batches     WHERE started_at     < :'cutoff';
DELETE FROM function_runs     WHERE run_started_at < :'cutoff';
DELETE FROM function_finishes WHERE created_at     < :'cutoff';
DELETE FROM history           WHERE created_at     < :'cutoff';
DELETE FROM traces            WHERE "timestamp"    < :'cutoff';
-- trace_runs keeps epoch milliseconds; spans keep timestamptz.
DELETE FROM trace_runs        WHERE queued_at      < extract(epoch FROM :'cutoff'::timestamp AT TIME ZONE 'UTC') * 1000;
DELETE FROM spans             WHERE start_time     < :'cutoff'::timestamp AT TIME ZONE 'UTC';
COMMIT;

-- Make the freed space reusable now rather than at the next autovacuum.
VACUUM (ANALYZE) events, event_batches, function_runs, function_finishes, history, traces, trace_runs, spans;
