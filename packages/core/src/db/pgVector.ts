import { customType } from 'drizzle-orm/pg-core';

interface PgVectorConfig {
    dimension: number;
}

function toPgVectorLiteral(value: number[]) {
    return `[${value.join(",")}]`;
}

function fromPgVectorLiteral(value: string) {
    const trimmed = value.trim();
    if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
        return [];
    }

    const body = trimmed.slice(1, -1).trim();
    if (!body) {
        return [];
    }

    return body.split(",").map((part) => Number(part.trim()));
}

/**
 * @deprecated Use `vector` from `drizzle-orm/pg-core` instead:
 * `vector("embedding", { dimensions: 1536 })`. It emits the identical
 * `vector(N)` SQL type and the identical `[1,2,3]` wire format.
 *
 * This custom type is invisible to drizzle-kit's introspection, which means
 * index operator-class validation is silently skipped for columns declared
 * with it. Kept only because it is part of `@launchstack/core`'s public API;
 * the schema itself no longer uses it.
 */
export function pgVector(config: PgVectorConfig) {
    return customType<{
        data: number[];
        driverData: string;
    }>({
        dataType() {
            return `vector(${config.dimension})`;
        },

        fromDriver(value: string | number[]) {
            if (Array.isArray(value)) {
                return value;
            }

            return fromPgVectorLiteral(value);
        },

        toDriver(value: number[]) {
            return toPgVectorLiteral(value);
        },
    });
}
