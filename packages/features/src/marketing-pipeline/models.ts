/**
 * Shared provider-neutral structured response entry point for marketing.
 */

import type { BaseMessageLike } from "@langchain/core/messages";
import {
  invokeStructured,
  resolveChatModel,
} from "@launchstack/core/llm";
import type { z } from "zod";

export async function invokeMarketingStructured<T>(
  schema: z.ZodType<T>,
  messages: readonly BaseMessageLike[],
  name: string,
): Promise<T> {
  return invokeStructured(
    resolveChatModel({ route: "fast" }),
    schema,
    messages,
    { name },
  );
}
