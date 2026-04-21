/**
 * Concrete JobDispatcherPort implementation that wraps the app's existing
 * job dispatcher (~/lib/jobs). This is what apps/web hands to createEngine
 * so core can enqueue background work without importing Inngest directly.
 *
 * The underlying dispatcher factory already selects the runner from env;
 * the port just adapts its shape to the JobDispatcherPort interface exported
 * by @launchstack/core.
 */

import type {
  JobDispatcherPort,
  DispatchEvent,
  DispatchResult,
} from "@launchstack/core/jobs";

import { getDispatcher } from "~/lib/jobs";

export function createAppJobDispatcherPort(): JobDispatcherPort {
  const dispatcher = getDispatcher();

  return {
    name: dispatcher.name.toLowerCase(),

    async dispatch(event: DispatchEvent): Promise<DispatchResult> {
      // The existing dispatcher signature is document-processing-specific:
      // it sends a single well-known Inngest event name and expects the
      // payload shape of ProcessDocumentEventData. Since that is the only
      // event fired today, we adapt the generic port by forwarding `data`
      // as-is. Once additional event names appear, the underlying
      // dispatcher will need a generalized `send(name, data)` method.
      void event.name;
      const result = await dispatcher.dispatch(
        event.data as unknown as Parameters<typeof dispatcher.dispatch>[0],
      );
      return {
        jobId: result.jobId,
        eventIds: result.eventIds,
      };
    },
  };
}
