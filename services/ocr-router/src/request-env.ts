/**
 * Per-request environment overrides for the router.
 *
 * The routing logic reads its configuration from process.env, but the router is
 * a single process serving every caller — so overrides that arrive with a
 * request cannot simply be written and left there. Two things go wrong if they
 * are: one request's values leak into the next, and a request that stays silent
 * about a variable (or sends a blank) erases what the container was started
 * with, including the GOOGLE_AI_API_KEY that docker-compose supplies.
 *
 * Snapshotting at module load and restoring before each request fixes both:
 * silence leaves the container's own configuration standing, and nothing a
 * caller sets outlives the request that set it.
 *
 * Known limitation: Express serves requests concurrently and the routing work is
 * async, so two overlapping /route calls can still interleave their writes.
 * Removing that means threading configuration through complexity.ts as a
 * parameter instead of reading process.env.
 */

const BASELINE_ENV: NodeJS.ProcessEnv = { ...process.env };

/**
 * Resets process.env to the container's startup configuration, then applies the
 * request's non-empty overrides on top.
 */
export function applyRequestEnv(env: Record<string, string> | undefined): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in BASELINE_ENV)) delete process.env[key];
  }
  Object.assign(process.env, BASELINE_ENV);

  for (const [key, value] of Object.entries(env ?? {})) {
    if (value) process.env[key] = value;
  }
}
