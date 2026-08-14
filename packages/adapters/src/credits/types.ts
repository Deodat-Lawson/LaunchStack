/**
 * Credits port — the boundary core uses to debit per-company token balances
 * when a subsystem consumes a paid-per-use capability (embeddings, NER, OCR,
 * LLM chat, etc.).
 *
 * Concrete implementations (the app's tokenAccounts/tokenTransactions tables,
 * Stripe-backed metering, a no-op stub) live outside core; the hosting app
 * hands one in via CoreConfig.credits.port. When the port is absent, the
 * `creditsDebitSafe` helper is a no-op so self-hosted deploys that don't
 * meter usage don't have to supply one.
 */

export interface CreditsPort {
  /** Debit a per-company service balance. Non-throwing implementations are
   *  expected; credit bookkeeping failures should not break ingestion. */
  debit(input: DebitInput): Promise<void>;
}

export interface DebitInput {
  companyId: bigint;
  service: TokenService;
  tokens: number;
  /** Human-readable description for the transaction log. */
  description?: string;
  /** Caller-supplied reference (e.g. documentId) for correlating a debit. */
  referenceId?: string;
  /** Arbitrary metadata to attach to the transaction record. */
  metadata?: Record<string, unknown>;
}

export type TokenService =
  | "embedding"
  | "rerank"
  | "ner"
  | "transcription"
  | "ocr_azure"
  | "ocr_landingai"
  | "ocr_datalab"
  | "ocr_native"
  | "llm_chat";
