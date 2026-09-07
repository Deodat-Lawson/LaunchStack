/**
 * Actor and workspace context (ADR-002 §application).
 *
 * Product identity (Clerk users, memberships, cookies) is translated into
 * this plain shape AT the web/worker boundary. Nothing in application,
 * evidence, or adapters sees authentication primitives — only the resolved
 * workspace scope and an opaque actor id kept for provenance.
 */
export interface ActorContext {
    /** Opaque product-side actor id, recorded for provenance only. */
    actorId: string;
    /** The workspace (company) the actor is operating in — already authorized. */
    companyId: number;
}

/** Log fields every use case forwards to the logger. */
export interface TraceContext {
    traceId: string;
}
