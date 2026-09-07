import type { DbClient } from "@launchstack/store/client";

/** The client inside a `db.transaction(async tx => …)` callback. */
export type Tx = Parameters<Parameters<DbClient["transaction"]>[0]>[0];

/** Either the shared client or a transaction — for helpers that run in both. */
export type Executor = DbClient | Tx;
