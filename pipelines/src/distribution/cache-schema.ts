/**
 * Stored place pools for the keyless place search (./keyless/pool): which map
 * requests were sent for a set of tags in a territory, and the places they
 * found. A second run reads the pool instead of asking the public servers
 * again, and an unfinished sweep carries on from it.
 *
 * Public OpenStreetMap data, the same for every workspace, so the table has
 * no company column: a pool is filled once and read by whoever asks next,
 * and deleting a workspace leaves nothing behind in it.
 */
import { sql } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";
import { boolean, index, integer, jsonb, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { pgTable } from "@launchstack/store/schema/helpers";

import type { PlacePoolState } from "./keyless/pool";

export const distributionPlacePools = pgTable(
    "distribution_place_pools",
    {
        /** SHA-256 of the country, region, tag selectors and name words (keyless/pool `placePoolKey`). */
        cacheKey: varchar("cache_key", { length: 64 }).primaryKey(),
        // The next four columns repeat parts of `state` for a person reading the table.
        country: varchar("country", { length: 2 }).notNull(),
        region: varchar("region", { length: 128 }),
        selectors: text("selectors").notNull(),
        /** True once every place in scope is known and no request is left to send. */
        complete: boolean("complete").notNull().default(false),
        /** Places with a website in the pool. */
        places: integer("places").notNull().default(0),
        /** The pool itself: places, the sweep's waiting boxes, request counts. */
        state: jsonb("state").$type<PlacePoolState>().notNull(),
        createdAt: timestamp("created_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .default(sql`CURRENT_TIMESTAMP`)
            .notNull(),
    },
    table => ({
        countryIdx: index("distribution_place_pools_country_idx").on(table.country),
    })
);

export type DistributionPlacePoolRow = InferSelectModel<typeof distributionPlacePools>;
