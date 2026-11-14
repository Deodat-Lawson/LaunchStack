/**
 * Run work after the tool call has answered: the in-process executor for the
 * follow-up note (`./follow-up-queue`), used unless the deployment runs it on
 * the worker.
 *
 * Next's `after()` is how this app does post-response work for a request
 * (company-profile builds, proposals runs): the response goes out, then the
 * callback runs in the same process, which the platform keeps alive for it,
 * in the request's async context (so the MCP route's workspace models still
 * apply). It needs no worker — but it is not durable: a restart in that
 * window drops the work, which is why a deployment with the worker attached
 * queues the note through Inngest instead.
 *
 * Outside a request (a script, a test) `after()` throws; the work then runs
 * detached instead of being dropped.
 */
import { after } from "next/server";

export function runAfterResponse(label: string, work: () => Promise<unknown>): void {
    const task = async () => {
        try {
            await work();
        } catch (error) {
            console.error(`[assistant-conversations] ${label} failed:`, error);
        }
    };
    try {
        after(task);
    } catch {
        void task();
    }
}
