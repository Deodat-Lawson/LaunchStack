/**
 * Token accounting normalized at the shared chat boundary.
 *
 * OpenAI-compatible servers are consistent about the wire format but not
 * about what LangChain surfaces: some responses populate the portable
 * `usage_metadata`, others only carry the raw `usage` block through
 * `response_metadata`. Callers should never have to know which — every
 * credit debit and every "tokens used" badge reads the same shape.
 */

export interface ChatTokenUsage {
  /** Undefined means the endpoint reported nothing, not zero. */
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Reasoning tokens, when the endpoint breaks them out. */
  reasoningTokens?: number;
}

function toCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function withTotal(usage: ChatTokenUsage): ChatTokenUsage {
  if (usage.totalTokens !== undefined) return usage;
  if (usage.inputTokens === undefined && usage.outputTokens === undefined) {
    return usage;
  }
  return {
    ...usage,
    totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
  };
}

/**
 * Read usage from a chat response. Accepts an `AIMessage`, a raw response
 * object, or anything shaped like one, and returns only the fields actually
 * reported.
 */
export function normalizeTokenUsage(response: unknown): ChatTokenUsage {
  const message = record(response);
  if (!message) return {};

  // Portable LangChain field — preferred when present.
  const portable = record(message.usage_metadata);
  if (portable) {
    const details = record(portable.output_token_details);
    return withTotal({
      inputTokens: toCount(portable.input_tokens),
      outputTokens: toCount(portable.output_tokens),
      totalTokens: toCount(portable.total_tokens),
      reasoningTokens: toCount(details?.reasoning),
    });
  }

  const metadata = record(message.response_metadata) ?? {};

  // LangChain's OpenAI adapter camel-cases this one.
  const tokenUsage = record(metadata.tokenUsage);
  if (tokenUsage) {
    return withTotal({
      inputTokens: toCount(tokenUsage.promptTokens),
      outputTokens: toCount(tokenUsage.completionTokens),
      totalTokens: toCount(tokenUsage.totalTokens),
    });
  }

  // Raw provider block, straight off the wire.
  const usage = record(metadata.usage) ?? record(message.usage);
  if (usage) {
    const details = record(usage.completion_tokens_details);
    return withTotal({
      inputTokens: toCount(usage.prompt_tokens) ?? toCount(usage.input_tokens),
      outputTokens:
        toCount(usage.completion_tokens) ?? toCount(usage.output_tokens),
      totalTokens: toCount(usage.total_tokens),
      reasoningTokens: toCount(details?.reasoning_tokens),
    });
  }

  return {};
}

/** Sum usage across a multi-step run. Absent values stay absent. */
export function addTokenUsage(
  a: ChatTokenUsage,
  b: ChatTokenUsage,
): ChatTokenUsage {
  const add = (x?: number, y?: number) =>
    x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0);
  return {
    inputTokens: add(a.inputTokens, b.inputTokens),
    outputTokens: add(a.outputTokens, b.outputTokens),
    totalTokens: add(a.totalTokens, b.totalTokens),
    reasoningTokens: add(a.reasoningTokens, b.reasoningTokens),
  };
}
