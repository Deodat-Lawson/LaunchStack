/**
 * E1 segments: one OpenStreetMap category in one country. The category is
 * the target, so every place Photon returns for it is on target and the
 * whole population is known from Overpass: the experiment measures coverage
 * per request, not relevance.
 */
export type Bbox = readonly [minLon: number, minLat: number, maxLon: number, maxLat: number];

export interface PlaceSegment {
    id: string;
    label: string;
    country: string;
    /** Rough country bounding box; places outside the country are dropped by country code. */
    bbox: Bbox;
    /** Photon `osm_tag` filter, "key:value". */
    tag: string;
    /** Overpass-style selector for the same category, as production passes it. */
    selector: string;
    /** Photon needs a `q`; production sends the tag's value with spaces. */
    q: string;
    /** What a segment form would hold as categories (production's keyword searches). */
    keywords: string[];
}

export const SEGMENTS: PlaceSegment[] = [
    {
        id: "dk-bicycle",
        label: "Bicycle shops · Denmark",
        country: "DK",
        bbox: [8.0, 54.5, 15.3, 57.8],
        tag: "shop:bicycle",
        selector: '["shop"="bicycle"]',
        q: "bicycle",
        keywords: ["bicycle shop"],
    },
    {
        id: "be-chocolate",
        label: "Chocolate shops · Belgium",
        country: "BE",
        bbox: [2.5, 49.45, 6.45, 51.55],
        tag: "shop:chocolate",
        selector: '["shop"="chocolate"]',
        q: "chocolate",
        keywords: ["chocolate shop"],
    },
    {
        id: "ie-dentist",
        label: "Dental practices · Ireland",
        country: "IE",
        bbox: [-10.7, 51.3, -5.9, 55.5],
        tag: "amenity:dentist",
        selector: '["amenity"="dentist"]',
        q: "dentist",
        keywords: ["dentist"],
    },
    {
        id: "be-brewery",
        label: "Craft breweries · Belgium",
        country: "BE",
        bbox: [2.5, 49.45, 6.45, 51.55],
        tag: "craft:brewery",
        selector: '["craft"="brewery"]',
        q: "brewery",
        keywords: ["brewery"],
    },
    {
        id: "nl-bicycle",
        label: "Bicycle shops · Netherlands",
        country: "NL",
        bbox: [3.3, 50.7, 7.25, 53.6],
        tag: "shop:bicycle",
        selector: '["shop"="bicycle"]',
        q: "bicycle",
        keywords: ["bicycle shop"],
    },
    {
        id: "dk-dentist",
        label: "Dental practices · Denmark",
        country: "DK",
        bbox: [8.0, 54.5, 15.3, 57.8],
        tag: "amenity:dentist",
        selector: '["amenity"="dentist"]',
        q: "dentist",
        keywords: ["dentist"],
    },
];
