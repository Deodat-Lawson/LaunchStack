import postgres, { type Sql } from "postgres";

const holder = globalThis as unknown as {
    __launchstackPostgresClients?: Map<string, Sql>;
};

/**
 * One postgres.js client per name for the life of the process.
 *
 * `next dev` re-evaluates route and middleware bundles on every recompile. A
 * client created per evaluation keeps its sockets open, and their closures pin
 * the whole superseded module graph — about 30 MB per recompile. The engine
 * caches its pool on globalThis for the same reason (see ~/server/engine).
 * Imports nothing beyond postgres.js, so the middleware bundle stays small.
 */
export function sharedPostgresClient(name: string, url: string, max: number): Sql {
    const clients = (holder.__launchstackPostgresClients ??= new Map<string, Sql>());
    let client = clients.get(name);
    if (!client) {
        client = postgres(url, { max });
        clients.set(name, client);
    }
    return client;
}
