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
