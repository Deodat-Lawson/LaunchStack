/**
 * Error hierarchy for @launchstack/core. Features and host code should throw
 * these subclasses so the hosting app can map categories of failure onto
 * HTTP status codes (or other surface-specific responses) without digging
 * into message strings.
 *
 * Convention:
 *   - ConfigError      → misconfiguration detected at boot or first use.
 *                        Host should surface as 500 and page an operator.
 *   - ProviderError    → upstream LLM / embedding / OCR provider misbehaved.
 *                        Usually transient; caller may retry with backoff.
 *   - StorageError     → blob store (S3, local disk, DB fallback) failed.
 *                        Caller should not auto-retry — investigate.
 *   - CreditsError     → per-tenant credit check or debit failed.
 *                        Host should surface as 402 (payment required).
 *   - ValidationError  → caller-supplied input violated a contract that
 *                        core couldn't fix. Map to 400.
 */

export class LaunchstackError extends Error {
  readonly code: string;
  readonly cause?: unknown;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "LaunchstackError";
    this.code = code;
    this.cause = options?.cause;
  }
}

export class ConfigError extends LaunchstackError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("LAUNCHSTACK_CONFIG", message, options);
    this.name = "ConfigError";
  }
}

export class ProviderError extends LaunchstackError {
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    provider: string,
    message: string,
    options?: { cause?: unknown; retryable?: boolean }
  ) {
    super("LAUNCHSTACK_PROVIDER", `${provider}: ${message}`, options);
    this.name = "ProviderError";
    this.provider = provider;
    this.retryable = options?.retryable ?? true;
  }
}

export class StorageError extends LaunchstackError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("LAUNCHSTACK_STORAGE", message, options);
    this.name = "StorageError";
  }
}

export class CreditsError extends LaunchstackError {
  readonly companyId?: string;

  constructor(
    message: string,
    options?: { cause?: unknown; companyId?: string }
  ) {
    super("LAUNCHSTACK_CREDITS", message, options);
    this.name = "CreditsError";
    this.companyId = options?.companyId;
  }
}

export class ValidationError extends LaunchstackError {
  readonly field?: string;

  constructor(message: string, options?: { cause?: unknown; field?: string }) {
    super("LAUNCHSTACK_VALIDATION", message, options);
    this.name = "ValidationError";
    this.field = options?.field;
  }
}

/** Type-guard helper — useful in host error middleware that maps codes to statuses. */
export function isLaunchstackError(value: unknown): value is LaunchstackError {
  return value instanceof LaunchstackError;
}
