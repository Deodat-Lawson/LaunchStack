/**
 * Trade-data port (distribution design §4.6, §5): "who ships what to whom"
 * from customs records. The port ships with a `none` default because every
 * real provider is a paid seat or API; the pipeline treats an absent
 * provider as a skipped stage with a visible reason, never an error.
 */

export type TradeRole = "importer" | "exporter";

export interface ShipmentQuery {
    /** Harmonised-system codes (2–10 digits) to match. */
    hsCodes?: readonly string[];
    /** Free-text product descriptions to match when HS codes are unknown. */
    keywords?: readonly string[];
    /** ISO-3166 alpha-2 of the counterparty we are looking for. */
    country: string;
    /** Which side of the shipment the counterparty is on. */
    role: TradeRole;
    /** Cap on records (provider default applies when omitted). */
    limit?: number;
    /** Only shipments on or after this ISO date. */
    since?: string;
}

export interface ShipmentRecord {
    /** The party receiving goods. */
    consignee: string;
    consigneeCountry?: string;
    /** The party sending goods. */
    shipper: string;
    shipperCountry?: string;
    hsCode?: string;
    description?: string;
    /** ISO date of the shipment or filing. */
    date?: string;
    weightKg?: number;
    /** Provider name, for provenance. */
    source: string;
    /** A link a human can open to see the record, when the provider has one. */
    sourceUrl?: string;
}

export interface TradeDataProvider {
    readonly name: string;
    searchShipments(
        query: ShipmentQuery,
        context?: { signal?: AbortSignal }
    ): Promise<ShipmentRecord[]>;
}
