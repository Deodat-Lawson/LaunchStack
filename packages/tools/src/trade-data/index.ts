import { getTradeDataProviderName } from "./config";
import type { ShipmentQuery, ShipmentRecord, TradeDataProvider } from "./types";

export * from "./types";

/** A provider over an in-memory record set — fixtures, tests, and CSV imports. */
export function createStaticTradeDataProvider(
    records: readonly ShipmentRecord[],
    name = "static"
): TradeDataProvider {
    return {
        name,
        async searchShipments(query: ShipmentQuery): Promise<ShipmentRecord[]> {
            const country = query.country.toUpperCase();
            const hs = (query.hsCodes ?? []).map(code => code.replace(/\D/g, ""));
            const keywords = (query.keywords ?? []).map(k => k.toLowerCase()).filter(Boolean);
            const since = query.since ? Date.parse(query.since) : Number.NaN;
            const matches = records.filter(record => {
                const partyCountry =
                    query.role === "importer" ? record.consigneeCountry : record.shipperCountry;
                if (partyCountry && partyCountry.toUpperCase() !== country) return false;
                if (!partyCountry) return false;
                if (hs.length > 0) {
                    const code = record.hsCode?.replace(/\D/g, "") ?? "";
                    if (!hs.some(prefix => code.startsWith(prefix))) return false;
                }
                if (keywords.length > 0) {
                    const haystack = (record.description ?? "").toLowerCase();
                    if (!keywords.some(k => haystack.includes(k))) return false;
                }
                if (!Number.isNaN(since) && record.date && Date.parse(record.date) < since)
                    return false;
                return true;
            });
            return matches.slice(0, query.limit ?? 200);
        },
    };
}

const registry = new Map<string, () => TradeDataProvider>();

/** Register a provider factory under a name (`TRADE_DATA_PROVIDER=<name>`). */
export function registerTradeDataProvider(name: string, factory: () => TradeDataProvider): void {
    registry.set(name, factory);
}

/**
 * The configured provider, or null when none is configured. `none` and an
 * unset variable both mean null; an unknown name is logged and treated as
 * none so a typo degrades the stage instead of failing the run.
 */
export function resolveTradeDataProvider(override?: string): TradeDataProvider | null {
    const name = (override ?? getTradeDataProviderName() ?? "none").trim();
    if (!name || name === "none") return null;
    const factory = registry.get(name);
    if (!factory) {
        console.warn(`[trade-data] Unknown provider "${name}"; treating as none.`);
        return null;
    }
    return factory();
}

export function isTradeDataConfigured(): boolean {
    return resolveTradeDataProvider() !== null;
}
