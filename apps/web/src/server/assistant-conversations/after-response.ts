/**
 * Run work after the tool call has answered.
 *
 * Next's `after()` is how this app does post-response work for a request
 * (company-profile builds, proposals runs): the response goes out, then the
 * callback runs in the same process, which the platform keeps alive for it.
 * It needs no queue, no worker registration and no new event type, and the
 * work it does here is recoverable by design — its state is on the
 * `assistant_conversations` row and a re-save queues it again.
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
