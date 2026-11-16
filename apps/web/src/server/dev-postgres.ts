import { createHash } from "node:crypto";
import postgres from "postgres";

type PoolConfiguration = Readonly<{ consumer: "auth" | "middleware"; url: string; max: number }>;
const developmentGlobal = globalThis as typeof globalThis & {
    __launchstackDevelopmentPostgres?: Map<string, ReturnType<typeof postgres>>;
};

/** Preserve native clients across development HMR, never across DB/config identities.
 * Production lifetime remains controlled by each caller's existing module singleton.
 * Cache keys are digests so database credentials never appear in diagnostic keys.
 */
export function getPostgresClient(configuration: PoolConfiguration): ReturnType<typeof postgres> {
    const create = () => postgres(configuration.url, { max: configuration.max });
    if (process.env.NODE_ENV !== "development") return create();
    const key = createHash("sha256")
        .update(JSON.stringify([configuration.consumer, configuration.url, configuration.max]))
        .digest("hex");
    const pools = (developmentGlobal.__launchstackDevelopmentPostgres ??= new Map<
        string,
        ReturnType<typeof postgres>
    >());
    const existing = pools.get(key);
    if (existing) return existing;
    const client = create();
    pools.set(key, client);
    return client;
}
