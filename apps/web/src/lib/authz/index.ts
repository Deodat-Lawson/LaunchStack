/**
 * Server-side authorization: permissions, scope, escalation rules, audit.
 *
 * Client components import from `~/lib/authz/permissions` and
 * `~/lib/authz/scope-types` directly — those two modules are dependency-free.
 * This barrel pulls in the database and is for server code only.
 */

export * from "./permissions";
export * from "./scope-types";
export * from "./escalation";
export { resolveRole, resolvePermissionsForRole, type ResolvedRole } from "./resolve";
export {
    resolveDocumentScope,
    documentScopePredicate,
    scopedDocumentWhere,
    scopeAllows,
    type ScopeSubject,
} from "./scope";
export {
    recordAuditEvent,
    isAuditAction,
    AUDIT_ACTIONS,
    type AuditAction,
    type AuditEventInput,
    type AuditExecutor,
    type AuditTargetType,
} from "./audit";
