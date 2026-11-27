/**
 * A child process of run.ts: receives one job, runs it, sends the result back.
 * Not an entry point.
 */
import { type JobSpec, runJob } from "./job";

process.on("message", (job: JobSpec) => {
    runJob(job).then(
        result => {
            process.send?.({ ok: true, result }, () => process.exit(0));
        },
        (error: unknown) => {
            const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
            process.send?.({ ok: false, error: message }, () => process.exit(1));
        }
    );
});
