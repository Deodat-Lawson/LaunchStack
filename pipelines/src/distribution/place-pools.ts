/**
 * Place pools in the database (./cache-schema): what the keyless place
 * search has asked the public map servers and what they returned, kept so a
 * second run starts where the first stopped. Not scoped by company: a pool
 * is public OpenStreetMap data and is shared (see ./cache-schema).
 */
import { eq } from "drizzle-orm";

import { getDb } from "@launchstack/store/client";

import { distributionPlacePools } from "./cache-schema";
import type { PlacePoolState, PlacePoolStore } from "./keyless/pool";

export function createDbPlacePoolStore(): PlacePoolStore {
    return {
        async load(key: string): Promise<PlacePoolState | null> {
            const [row] = await getDb()
                .select({ state: distributionPlacePools.state })
                .from(distributionPlacePools)
                .where(eq(distributionPlacePools.cacheKey, key))
                .limit(1);
            return row?.state ?? null;
        },
        async save(key: string, state: PlacePoolState): Promise<void> {
            const values = {
                country: state.country,
                region: state.region,
                selectors: state.selectors.join(" "),
                complete: state.complete,
                places: Object.keys(state.places).length,
                state,
                updatedAt: new Date(),
            };
            await getDb()
                .insert(distributionPlacePools)
                .values({ cacheKey: key, ...values })
                .onConflictDoUpdate({ target: distributionPlacePools.cacheKey, set: values });
        },
    };
}
