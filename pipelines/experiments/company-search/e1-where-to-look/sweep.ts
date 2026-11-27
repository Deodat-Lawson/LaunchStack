/**
 * One search word's quadtree, recorded: Photon is asked for the country box,
 * and every box that came back full is split into four and asked again.
 *
 * A box whose request gets no answer is kept as a hole (`NodeAnswer.failed`),
 * never as an empty box: an empty page says the box holds nothing, a timeout
 * or a 503 says nothing at all.
 */
import {
    answered,
    exchangeWithRetries,
    failureDetail,
    type ExchangeSource,
    type RetryOptions,
} from "../lib/recorder";
import { MAX_DEPTH } from "./env";
import type { Bbox, PlaceSegment } from "./segments";
import { PHOTON_CAP, childBboxes, photonUrl, type NodeAnswer, type Place } from "./world";

interface PhotonFeature {
    geometry?: { coordinates?: [number, number] };
    properties: {
        osm_type?: "N" | "W" | "R";
        osm_id?: number;
        name?: string;
        countrycode?: string;
    };
}

function inCountryPlaces(features: PhotonFeature[], country: string): Place[] {
    const out: Place[] = [];
    for (const f of features) {
        const p = f.properties;
        const coords = f.geometry?.coordinates;
        if (!p.osm_id || !p.osm_type || !p.name || !coords) continue;
        if ((p.countrycode ?? "").toUpperCase() !== country) continue;
        out.push({ id: `${p.osm_type}${p.osm_id}`, name: p.name, lon: coords[0], lat: coords[1] });
    }
    return out;
}

export interface Sweep {
    nodes: Record<string, NodeAnswer>;
    /** Boxes asked, answered or not. */
    requests: number;
    /** Boxes that got no answer. */
    unanswered: number;
}

/**
 * The whole quadtree for one search word. Places found are added to `places`.
 * While recording, a box that gets no answer is asked again (see
 * `exchangeWithRetries`); a request that was never recorded throws.
 */
export async function sweep(
    segment: PlaceSegment,
    term: string,
    source: ExchangeSource,
    places: Record<string, Place>,
    retry: RetryOptions = {}
): Promise<Sweep> {
    const nodes: Record<string, NodeAnswer> = {};
    let requests = 0;
    let unanswered = 0;
    const queue: Array<{ id: string; bbox: Bbox; depth: number }> = [
        { id: "r", bbox: segment.bbox, depth: 0 },
    ];
    while (queue.length > 0) {
        const node = queue.shift()!;
        const exchange = await exchangeWithRetries(source, photonUrl(segment, term, node.bbox), {
            onFailure: (failed, attempt, attempts) =>
                console.warn(
                    `  photon gave no answer for "${term}" ${node.id} (try ${attempt} of ${attempts}): ${failureDetail(failed)}`
                ),
            ...retry,
        });
        requests += 1;
        if (!answered(exchange)) {
            unanswered += 1;
            nodes[node.id] = {
                id: node.id,
                bbox: node.bbox,
                depth: node.depth,
                places: [],
                capped: false,
                failed: true,
            };
            continue;
        }
        const features = (JSON.parse(exchange.body) as { features: PhotonFeature[] }).features;
        const found = inCountryPlaces(features, segment.country);
        for (const p of found) places[p.id] ??= p;
        const capped = features.length >= PHOTON_CAP;
        nodes[node.id] = {
            id: node.id,
            bbox: node.bbox,
            depth: node.depth,
            places: found.map(p => p.id),
            capped,
        };
        if (capped && node.depth < MAX_DEPTH) {
            for (const [i, bbox] of childBboxes(node.bbox).entries())
                queue.push({ id: `${node.id}.${i}`, bbox, depth: node.depth + 1 });
        }
    }
    return { nodes, requests, unanswered };
}
