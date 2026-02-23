import { inngest } from "../client";
import { runTrendSearch } from "~/server/trend-search/run";
import { updateJobResults, updateJobStatus } from "~/server/trend-search/db";
import {
  TrendSearchEventDataSchema,
  type TrendSearchEventData,
  type TrendSearchOutput,
} from "~/server/trend-search/types";
import type { TrendSearchPipelineStage } from "~/server/trend-search/run";

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "string" && error.length > 0) {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown trend search pipeline error";
  }
}

function parseCompanyId(companyId: string): bigint {
  try {
    return BigInt(companyId);
  } catch {
    throw new Error(`Invalid trend search companyId: ${companyId}`);
  }
}

async function updateStatusOrThrow(
  jobId: string,
  companyId: bigint,
  status: TrendSearchPipelineStage | "completed" | "failed",
  errorMessage?: string,
) {
  const updated = await updateJobStatus(jobId, companyId, status, errorMessage);
  if (!updated) {
    throw new Error(`Trend search job not found for status update: ${jobId}`);
  }
}

async function persistResultsOrThrow(
  jobId: string,
  companyId: bigint,
  output: TrendSearchOutput,
) {
  const updated = await updateJobResults(jobId, companyId, output);
  if (!updated) {
    throw new Error(`Trend search job not found for result persistence: ${jobId}`);
  }
}

function toPipelineInput(eventData: TrendSearchEventData) {
  return {
    query: eventData.query,
    companyContext: eventData.companyContext,
    ...(eventData.categories ? { categories: eventData.categories } : {}),
  };
}

export const trendSearchJob = inngest.createFunction(
  {
    id: "trend-search-job",
    name: "Trend Search Pipeline",
    retries: 3,
    onFailure: async ({ error, event }) => {
      const parsed = TrendSearchEventDataSchema.safeParse(event.data);
      if (!parsed.success) {
        console.error("[TrendSearch] Failed job with invalid event payload:", parsed.error);
        return;
      }

      try {
        await updateStatusOrThrow(
          parsed.data.jobId,
          parseCompanyId(parsed.data.companyId),
          "failed",
          toErrorMessage(error),
        );
      } catch (failureError) {
        console.error("[TrendSearch] Failed to mark trend search job as failed:", failureError);
      }
    },
  },
  { event: "trend-search/run.requested" },
  async ({ event, step }) => {
    const eventData = TrendSearchEventDataSchema.parse(event.data);
    const jobId = eventData.jobId;
    const companyId = parseCompanyId(eventData.companyId);

    const output = (await step.run("run-pipeline", async () => {
      let lastStage: TrendSearchPipelineStage | null = null;

      const onStageChange = async (stage: TrendSearchPipelineStage) => {
        if (stage === lastStage) return;
        lastStage = stage;
        await updateStatusOrThrow(jobId, companyId, stage);
      };

      await onStageChange("searching");

      return runTrendSearch(toPipelineInput(eventData), {
        onStageChange,
      });
    })) as TrendSearchOutput;

    return (await step.run("persist", async () => {
      await persistResultsOrThrow(jobId, companyId, output);
      await updateStatusOrThrow(jobId, companyId, "completed");
      return output;
    })) as TrendSearchOutput;
  },
);
