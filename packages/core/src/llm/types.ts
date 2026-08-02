/**
 * Chat model types for the single-endpoint, model-aware architecture.
 *
 * The deployment points at exactly one OpenAI-compatible chat endpoint. What
 * varies between models is not the *protocol* but the *behavior*: whether the
 * model accepts images, how it is told to reason, which structured-output
 * mechanisms it implements, and which request fields it tolerates. Endpoint
 * compatibility and model capability are therefore modelled separately —
 * the same split LibreChat, Aider, Continue, and LiteLLM converged on.
 *
 * Nothing here is inferred from the model id. A model either references a
 * verified preset or declares its behavior in full.
 */

/**
 * Operator-assigned routes. A route is a *job*, not a model: callers ask for
 * the kind of work they need and the operator decides which model serves it.
 *
 * `fast` is a cost/latency choice, not a capability — a deployment is free to
 * point it at the same model as `default`.
 */
export const ChatRoutes = ["default", "fast", "reasoning", "vision"] as const;
export type ChatRoute = (typeof ChatRoutes)[number];

/** Routes that may inherit `default` and can be reported unavailable. */
export const SpecializedChatRoutes = ["fast", "reasoning", "vision"] as const;
export type SpecializedChatRoute = (typeof SpecializedChatRoutes)[number];

export function isChatRoute(value: string): value is ChatRoute {
  return (ChatRoutes as readonly string[]).includes(value);
}

/**
 * Capabilities a route can be required to have. Structured output is
 * deliberately absent: it is invocation behavior (native when declared,
 * strict-JSON fallback otherwise), never a reason to reject a route.
 */
export const ChatCapabilities = ["vision", "reasoning"] as const;
export type ChatCapability = (typeof ChatCapabilities)[number];

/**
 * The endpoint used when configuration names none.
 *
 * Google's OpenAI-compatibility surface for the Gemini API. It implements the
 * `/chat/completions` protocol, so every route, preset and adapter in this
 * package reaches it the same way it reaches any other endpoint — nothing here
 * is Gemini-specific beyond the URL and the model ids.
 *
 * This is a built-in vendor default, which the previous release deliberately
 * removed. It is back by explicit operator decision: an out-of-the-box
 * deployment should answer prompts rather than refuse to boot. The trade-off
 * is the one that default carries — a deployment that sets no endpoint sends
 * its prompts, and whatever credential it holds, to Google. Set
 * `CHAT_BASE_URL` (and the matching `CHAT_API_KEY`) to send them anywhere
 * else; every resolution path still prefers explicit configuration over this.
 *
 * Written without the trailing slash Google's docs show. Most consumers strip
 * it (`embeddings.ts`, `providers/registry.ts`) or normalize it (the OpenAI
 * SDK), but `services/ocr-router/src/complexity.ts` concatenates the value
 * raw, and would produce `…/openai//chat/completions`.
 *
 * @see https://ai.google.dev/gemini-api/docs/openai
 */
export const GEMINI_BASE_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai";

/** Default chat model — Gemini's general-purpose tier. */
export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";

/** Default model for cheap, high-volume work (table summaries, classification). */
export const GEMINI_FAST_MODEL = "gemini-2.5-flash-lite";

/**
 * Default embeddings model. Supports Matryoshka truncation, so it can serve
 * the same 1536-wide vector column the previous OpenAI default wrote — see
 * `embeddings/index-registry.ts`.
 */
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";

/** The one endpoint every route talks to. */
export interface ChatEndpointConfig {
  /** Base URL of an OpenAI-compatible `/chat/completions` implementation. */
  baseUrl: string;
  /**
   * Bearer credential. Omitted for keyless local endpoints — never inherited
   * from another service's environment variable.
   */
  apiKey?: string;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export const ChatInputModalities = ["text", "image"] as const;
export type ChatInputModality = (typeof ChatInputModalities)[number];

export interface ChatImageInputLimits {
  /** Accepted image MIME types. Undefined means the model did not declare a list. */
  mimeTypes?: readonly string[];
  /** Maximum images per request. Undefined means undeclared, not unlimited. */
  maxImages?: number;
}

// ---------------------------------------------------------------------------
// Reasoning
// ---------------------------------------------------------------------------

/**
 * How a model is asked to reason.
 *
 * - `none`    — the model has no reasoning control; the reasoning route is unavailable.
 * - `always`  — the model always reasons; nothing is toggled per request.
 * - `toggle`  — reasoning is on/off, each state mapping to an exact request patch.
 * - `effort`  — named levels, each mapping to an exact request patch.
 * - `budget`  — a numeric token budget written to a declared request field.
 */
export const ReasoningModes = [
  "none",
  "always",
  "toggle",
  "effort",
  "budget",
] as const;
export type ReasoningMode = (typeof ReasoningModes)[number];

/**
 * A verbatim fragment merged into the JSON request body. Operators declare
 * these because only they know what their endpoint accepts; the resolver
 * validates them but never invents them.
 */
export type ChatRequestPatch = Readonly<Record<string, unknown>>;

export interface ReasoningNoneBehavior {
  mode: "none";
}

export interface ReasoningAlwaysBehavior {
  mode: "always";
  /** Optional fields the endpoint needs even though reasoning is not optional. */
  request?: ChatRequestPatch;
}

export interface ReasoningToggleBehavior {
  mode: "toggle";
  /** Body patch applied when the caller asks for reasoning. */
  on: ChatRequestPatch;
  /** Body patch applied when the caller does not. Omitted means "send nothing". */
  off?: ChatRequestPatch;
}

export interface ReasoningEffortBehavior {
  mode: "effort";
  /** Selectable level name → exact body patch. At least one entry. */
  levels: Readonly<Record<string, ChatRequestPatch>>;
  /** Level used when the caller enables reasoning without naming one. */
  default: string;
  /** Body patch applied when the caller does not ask for reasoning. */
  off?: ChatRequestPatch;
}

export interface ReasoningBudgetBehavior {
  mode: "budget";
  /** Request-body field the token budget is written to. */
  field: string;
  default: number;
  min: number;
  max: number;
  /** Body patch applied when the caller does not ask for reasoning. */
  off?: ChatRequestPatch;
}

export type ChatReasoningBehavior =
  | ReasoningNoneBehavior
  | ReasoningAlwaysBehavior
  | ReasoningToggleBehavior
  | ReasoningEffortBehavior
  | ReasoningBudgetBehavior;

// ---------------------------------------------------------------------------
// Structured output
// ---------------------------------------------------------------------------

/**
 * Native structured-output mechanisms a model implements. An empty list is
 * meaningful and common: those models still produce validated objects through
 * the strict-JSON fallback.
 */
export const NativeStructuredOutputModes = [
  "json-object",
  "json-schema",
  "tool-calling",
] as const;
export type NativeStructuredOutputMode =
  (typeof NativeStructuredOutputModes)[number];

// ---------------------------------------------------------------------------
// Accepted request parameters
// ---------------------------------------------------------------------------

export const ParameterSupportValues = ["supported", "unsupported"] as const;
export type ParameterSupport = (typeof ParameterSupportValues)[number];

/**
 * Which request fields the model tolerates. Anything marked `unsupported` is
 * omitted from the request body rather than sent with a "safe" value —
 * several endpoints reject the field's mere presence.
 */
export interface ChatParameterBehavior {
  temperature: ParameterSupport;
  /** Whether a `role: "system"` message is accepted. */
  systemMessages: ParameterSupport;
  streaming: ParameterSupport;
  /** Whether an output-token cap is accepted at all. */
  maxOutputTokens: ParameterSupport;
  /**
   * Request field carrying that cap. Defaults to `max_tokens`; reasoning
   * models on several endpoints require `max_completion_tokens` instead and
   * reject the older field outright.
   */
  maxOutputTokensField?: string;
}

/** Field an output-token cap is written to when the model accepts one. */
export const DEFAULT_MAX_OUTPUT_TOKENS_FIELD = "max_tokens";

/**
 * Declared limits. Absent fields mean *unknown*: callers must not substitute a
 * guess, because an invented context window silently truncates real work.
 */
export interface ChatModelLimits {
  contextTokens?: number;
  maxOutputTokens?: number;
}

export interface ChatModelBehavior {
  input: readonly ChatInputModality[];
  /** Only meaningful when `input` includes "image". */
  image?: ChatImageInputLimits;
  reasoning: ChatReasoningBehavior;
  nativeStructuredOutput: readonly NativeStructuredOutputMode[];
  parameters: ChatParameterBehavior;
  limits?: ChatModelLimits;
}

/** A named model in the operator's configuration. */
export interface ChatModelDefinition {
  /** Arbitrary model id, sent verbatim to the endpoint. */
  id: string;
  behavior: ChatModelBehavior;
  /** Preset the behavior started from, when one was referenced. */
  preset?: string;
}

// ---------------------------------------------------------------------------
// Derived capability checks
// ---------------------------------------------------------------------------

export function behaviorSupportsVision(behavior: ChatModelBehavior): boolean {
  return behavior.input.includes("image");
}

export function behaviorSupportsReasoning(behavior: ChatModelBehavior): boolean {
  return behavior.reasoning.mode !== "none";
}

export function behaviorHasCapability(
  behavior: ChatModelBehavior,
  capability: ChatCapability,
): boolean {
  return capability === "vision"
    ? behaviorSupportsVision(behavior)
    : behaviorSupportsReasoning(behavior);
}

export function missingCapabilities(
  behavior: ChatModelBehavior,
  required: readonly ChatCapability[],
): ChatCapability[] {
  return required.filter(
    (capability) => !behaviorHasCapability(behavior, capability),
  );
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Configuration is wrong and the deployment cannot serve chat. Thrown while
 * parsing configuration so a bad file fails startup, not the first request.
 */
export class ChatConfigurationError extends Error {
  override readonly name = "ChatConfigurationError";
}

/**
 * The caller asked for something the configured models cannot do. Always a
 * client-visible 400: the deployment is fine, this particular request is not.
 */
export class ChatRequestError extends Error {
  override readonly name: string = "ChatRequestError";
  readonly status = 400 as const;
}

export type ChatRouteUnavailableReason =
  | "route-not-configured"
  | "missing-capability";

/**
 * A route cannot serve this request. Specialized routes fail closed: the
 * resolver never quietly swaps models or drops a requested capability, so
 * callers surface this as a typed HTTP 400 instead of silently degrading.
 */
export class ChatRouteUnavailableError extends ChatRequestError {
  override readonly name = "ChatRouteUnavailableError";
  readonly route: ChatRoute;
  readonly reason: ChatRouteUnavailableReason;
  readonly missingCapabilities: readonly ChatCapability[];

  constructor(options: {
    route: ChatRoute;
    reason: ChatRouteUnavailableReason;
    missingCapabilities?: readonly ChatCapability[];
    message: string;
  }) {
    super(options.message);
    this.route = options.route;
    this.reason = options.reason;
    this.missingCapabilities = Object.freeze([
      ...(options.missingCapabilities ?? []),
    ]);
  }
}

/** A reasoning effort or budget outside what the selected model declares. */
export class InvalidReasoningControlError extends ChatRequestError {
  override readonly name = "InvalidReasoningControlError";
}

export function isChatRequestError(error: unknown): error is ChatRequestError {
  return error instanceof ChatRequestError;
}

export function isChatRouteUnavailableError(
  error: unknown,
): error is ChatRouteUnavailableError {
  return error instanceof ChatRouteUnavailableError;
}
