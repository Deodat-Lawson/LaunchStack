/**
 * Authorization metrics. Three signals, none of which change behaviour:
 *
 * - `authz_denied_total{permission,route}` — a permission gate said no.
 * - `authz_retrieval_dropped_total{scope}` — the post-retrieval gate dropped
 *   a chunk the SQL scope should already have excluded. Reads zero in normal
 *   operation; anything else means a retrieval leg is not applying the scope.
 * - `authz_scope_size{kind}` — how large a resolved scope is, so an
 *   unexpectedly wide deny-list shows up before it slows every query.
 */

import { Counter, Histogram } from "prom-client";

import { scopeSize, type DocumentScope } from "~/lib/authz/scope-types";

import { metricsRegistry } from "./registry";

export const authzDenied = new Counter({
    name: "authz_denied_total",
    help: "Requests refused because the membership lacks a permission",
    labelNames: ["permission", "route"],
    registers: [metricsRegistry],
});

export const authzRetrievalDropped = new Counter({
    name: "authz_retrieval_dropped_total",
    help: "Retrieved chunks dropped by the post-retrieval scope gate (should be zero)",
    labelNames: ["scope"],
    registers: [metricsRegistry],
});

export const authzScopeSize = new Histogram({
    name: "authz_scope_size",
    help: "Number of folder names and document ids in a resolved document scope",
    labelNames: ["kind"],
    buckets: [0, 1, 2, 5, 10, 20, 50, 100, 250, 500],
    registers: [metricsRegistry],
});

export function recordAuthzDenied(permission: string, route: string): void {
    authzDenied.inc({ permission, route });
}

/** Counts dropped chunks; a zero keeps the series present so a dashboard can alert on it. */
export function recordRetrievalDropped(scope: string, count = 1): void {
    authzRetrievalDropped.inc({ scope }, count);
}

export function observeScopeSize(scope: DocumentScope): void {
    authzScopeSize.observe({ kind: scope.kind }, scopeSize(scope));
}
