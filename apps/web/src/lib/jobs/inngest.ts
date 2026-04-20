/**
 * Inngest Job Dispatcher
 *
 * Default job dispatcher that sends document processing events to Inngest.
 * Inngest handles retries, observability, and step-based execution.
 */

import { env } from "~/env";
import type { JobDispatcher, DispatchResult } from "./types";
import type { ProcessDocumentEventData } from "~/lib/ocr/types";

export class InngestDispatcher implements JobDispatcher {
  readonly name = "Inngest";

  async dispatch(data: ProcessDocumentEventData): Promise<DispatchResult> {
    if (!env.server.INNGEST_EVENT_KEY || env.server.INNGEST_EVENT_KEY === "") {
      throw new Error(
        "INNGEST_EVENT_KEY is required when using Inngest (JOB_RUNNER=inngest). Add it to .env or switch job runners."
      );
    }
    const { inngest } = await import("~/server/inngest/client");

    const result = await inngest.send({
      name: "document/process.requested",
      data,
    });

    console.log(
      `[InngestDispatcher] Queued job=${data.jobId}, eventIds=${result.ids.length}`,
    );

    return {
      jobId: data.jobId,
      eventIds: result.ids,
    };
  }
}
