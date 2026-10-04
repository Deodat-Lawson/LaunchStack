/**
 * The organisation profile, as the proposal stages read it — a pure mapping
 * from the company profile's view. Proposals no longer builds its own: the
 * company profile is read from the workspace's own sources only, with every
 * fact quoted, and this is the shape the stages' prompts were written for.
 *
 * People, products and projects become one fact each ("Team", "Products and
 * services", …) so a draft can name them; their citations come with them.
 */
import { READER_VERSION, type ProfileView, type ViewEntry } from "../company-metadata";

import type { OrgProfile, ProfileFact } from "./types";

const MAX_FACTS = 40;
const MAX_VALUE = 2_000;

function clip(value: string): string {
    return value.length > MAX_VALUE ? `${value.slice(0, MAX_VALUE - 1)}…` : value;
}

function listFact(key: string, label: string, entries: ViewEntry[]): ProfileFact | null {
    if (entries.length === 0) return null;
    return {
        key,
        label,
        value: clip(entries.map(e => (e.detail ? `${e.name} — ${e.detail}` : e.name)).join("; ")),
        cites: [...new Set(entries.flatMap(e => e.cites))].sort((a, b) => a - b),
        source: entries.every(e => e.source === "manual") ? "manual" : "documents",
    };
}

export function orgProfileFromView(view: ProfileView, builtAt: Date): OrgProfile {
    const facts: ProfileFact[] = view.facts.map(f => ({
        key: f.key.slice(0, 64),
        label: f.label.slice(0, 120),
        value: clip(f.value),
        cites: f.cites,
        source: f.source,
    }));
    for (const fact of [
        listFact("team", "Team", view.people),
        listFact("products_and_services", "Products and services", view.services),
        listFact("projects", "Projects", view.projects),
    ])
        if (fact) facts.push(fact);
    if (view.markets.length)
        facts.push({
            key: "markets",
            label: "Markets",
            value: clip(view.markets.join(", ")),
            cites: [],
            source: "documents",
        });

    return {
        summary: view.summary ?? "",
        applicantType: view.applicantType ?? "any",
        focusAreas: view.focusAreas.slice(0, 10),
        geography: view.geography.slice(0, 8),
        facts: facts.slice(0, MAX_FACTS),
        evidence: view.evidence.map(e => ({ ...e, url: null })),
        builtFrom: { documents: view.documents, snippets: view.evidence.length },
        builtAt: builtAt.toISOString(),
        promptVersion: READER_VERSION,
    };
}
