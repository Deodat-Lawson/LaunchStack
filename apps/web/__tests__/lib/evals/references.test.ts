/**
 * Reference dataset integrity tests.
 *
 * Covers validation requirements 7-11: anchor/held-out separation, no
 * near-duplicate campaign split across sections, per-platform counts (with
 * documented deficits), required metadata and source links, and no silently
 * duplicated sources.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Reuse the loader's repo-root resolution rather than counting `..` segments:
// this file sits at a different depth depending on repository layout
// (`__tests__/...` flat vs `apps/web/__tests__/...` monorepo).
import { getRepoRoot } from "~/lib/agents/evals/campaign";

const REFERENCE_PATH = join(getRepoRoot(), "references", "evaluation.md");
const RAW = readFileSync(REFERENCE_PATH, "utf8");

type Entry = {
    id: string;
    section: "anchors" | "held-out";
    fields: Record<string, string>;
    post: string;
    campaignGroup: string | null;
};

/** Split the document into entries, tracking which H2 section each sits under. */
function parseEntries(md: string): Entry[] {
    const lines = md.split("\n");
    const entries: Entry[] = [];

    let section: Entry["section"] | null = null;
    let current: Entry | null = null;
    let inPost = false;

    const flush = () => {
        if (current) {
            current.post = current.post.trim();
            entries.push(current);
        }
        current = null;
        inPost = false;
    };

    for (const line of lines) {
        const h2 = /^##\s+(.+)$/.exec(line);
        if (h2) {
            const title = (h2[1] ?? "").trim().toLowerCase();
            if (title === "anchors") {
                flush();
                section = "anchors";
            } else if (title === "held-out") {
                flush();
                section = "held-out";
            } else {
                // Any other H2 (Counts, Deficits, ...) ends the entry region.
                flush();
                section = null;
            }
            continue;
        }

        const h3 = /^###\s+(.+)$/.exec(line);
        if (h3 && section) {
            flush();
            current = {
                id: (h3[1] ?? "").trim(),
                section,
                fields: {},
                post: "",
                campaignGroup: null,
            };
            continue;
        }

        if (!current) continue;

        const h4 = /^####\s+(.+)$/.exec(line);
        if (h4) {
            inPost = /post/i.test(h4[1] ?? "");
            continue;
        }

        if (inPost) {
            if (line.startsWith(">")) current.post += line.replace(/^>\s?/, "") + "\n";
            continue;
        }

        const field = /^-\s+([a-z_]+):\s*(.*)$/.exec(line);
        if (field) {
            const key = (field[1] ?? "").trim();
            const value = (field[2] ?? "").trim();
            current.fields[key] = value;
            if (key === "campaign_group") current.campaignGroup = value.split(/\s/)[0] ?? null;
        }
    }
    flush();
    return entries;
}

const entries = parseEntries(RAW);
const anchors = entries.filter(e => e.section === "anchors");
const heldOut = entries.filter(e => e.section === "held-out");

describe("reference dataset structure", () => {
    it("has both an Anchors and a Held-out section with entries", () => {
        expect(RAW).toContain("## Anchors");
        expect(RAW).toContain("## Held-out");
        expect(anchors.length).toBeGreaterThan(0);
        expect(heldOut.length).toBeGreaterThan(0);
    });

    it("parses every entry with a non-empty post body", () => {
        expect(entries.length).toBeGreaterThan(0);
        for (const e of entries) {
            expect(e.post.length).toBeGreaterThan(0);
        }
    });
});

// Requirement 10
describe("every entry carries the required metadata", () => {
    const REQUIRED = [
        "platform",
        "company",
        "label",
        "source",
        "published",
        "selection_reason",
        "product_or_campaign",
    ] as const;

    it.each(entries.map(e => [e.id, e] as const))("%s", (_id, entry) => {
        for (const key of REQUIRED) {
            expect(entry.fields[key]).toBeDefined();
            expect((entry.fields[key] ?? "").length).toBeGreaterThan(0);
        }
        expect(["good", "bad"]).toContain(entry.fields.label);
        expect(entry.fields.source).toMatch(/^https?:\/\//);
    });

    it("records an engagement retrieval date wherever engagement is quoted", () => {
        for (const e of entries) {
            const eng = e.fields.engagement;
            if (!eng || /not available/i.test(eng)) continue;
            expect(eng).toMatch(/retrieved \d{4}-\d{2}-\d{2}/);
        }
    });

    it("uses ids that match their platform and label", () => {
        for (const e of entries) {
            const platform = (e.fields.platform ?? "").toLowerCase();
            const prefix = platform.startsWith("bluesky")
                ? "bsky"
                : platform.startsWith("linkedin")
                  ? "li"
                  : platform === "x"
                    ? "x"
                    : null;
            if (!prefix) continue;
            expect(e.id.startsWith(`${prefix}-`)).toBe(true);
            expect(e.id).toContain(`-${e.fields.label}-`);
        }
    });
});

// Requirement 7
describe("anchors and held-out do not overlap", () => {
    it("shares no entry id", () => {
        const a = new Set(anchors.map(e => e.id));
        for (const e of heldOut) expect(a.has(e.id)).toBe(false);
    });

    it("shares no source URL", () => {
        const a = new Set(anchors.map(e => e.fields.source));
        for (const e of heldOut) expect(a.has(e.fields.source)).toBe(false);
    });

    it("shares no post text", () => {
        const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
        const a = new Set(anchors.map(e => norm(e.post)));
        for (const e of heldOut) expect(a.has(norm(e.post))).toBe(false);
    });
});

// Requirement 8
describe("near-duplicates are not split across sections", () => {
    /** Word-level Jaccard similarity. */
    function similarity(a: string, b: string): number {
        const t = (s: string) =>
            new Set(
                s
                    .toLowerCase()
                    .replace(/[^\p{L}\p{N}\s]/gu, " ")
                    .split(/\s+/)
                    .filter(w => w.length > 3)
            );
        const sa = t(a);
        const sb = t(b);
        if (sa.size === 0 || sb.size === 0) return 0;
        let inter = 0;
        for (const w of sa) if (sb.has(w)) inter++;
        return inter / (sa.size + sb.size - inter);
    }

    it("keeps cross-section post similarity below 0.6", () => {
        const offenders: string[] = [];
        for (const a of anchors) {
            for (const h of heldOut) {
                const sim = similarity(a.post, h.post);
                if (sim >= 0.6) {
                    offenders.push(`${a.id} vs ${h.id} = ${sim.toFixed(2)}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it("keeps every declared campaign_group inside a single section", () => {
        const groups = new Map<string, Set<Entry["section"]>>();
        for (const e of entries) {
            if (!e.campaignGroup) continue;
            const set = groups.get(e.campaignGroup) ?? new Set();
            set.add(e.section);
            groups.set(e.campaignGroup, set);
        }
        for (const [group, sections] of groups) {
            expect({ group, sections: [...sections] }).toEqual({
                group,
                sections: [[...sections][0]],
            });
        }
    });
});

// Requirement 11
describe("no reference source is silently duplicated", () => {
    it("uses a unique entry id per entry", () => {
        const ids = entries.map(e => e.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("uses a unique source URL per entry", () => {
        const urls = entries.map(e => e.fields.source);
        const dupes = urls.filter((u, i) => urls.indexOf(u) !== i);
        expect(dupes).toEqual([]);
    });

    it("uses unique post text per entry", () => {
        const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
        const posts = entries.map(e => norm(e.post));
        const dupes = posts.filter((p, i) => posts.indexOf(p) !== i);
        expect(dupes).toEqual([]);
    });
});

// Requirement 9
describe("per-platform coverage", () => {
    function countsFor(platform: string) {
        const of = entries.filter(e =>
            (e.fields.platform ?? "").toLowerCase().startsWith(platform)
        );
        return {
            good: of.filter(e => e.fields.label === "good").length,
            bad: of.filter(e => e.fields.label === "bad").length,
            companies: new Set(of.map(e => e.fields.company)).size,
        };
    }

    const MET = ["bluesky", "linkedin", "x"] as const;

    it.each(MET)("meets the %s target of 10 good and at least 3 bad", platform => {
        const c = countsFor(platform);
        expect(c.good).toBeGreaterThanOrEqual(10);
        expect(c.bad).toBeGreaterThanOrEqual(3);
    });

    it.each(MET)("spreads %s posts across at least three companies", platform => {
        expect(countsFor(platform).companies).toBeGreaterThanOrEqual(3);
    });

    /**
     * Reddit could not be collected: official accounts post advisories and release
     * notes, not marketing. The brief requires the shortfall to be reported rather
     * than padded with fabricated posts, so the contract this test enforces is:
     * no Reddit entries AND an explicit written deficit.
     */
    it("documents the Reddit deficit instead of fabricating entries", () => {
        expect(countsFor("reddit").good + countsFor("reddit").bad).toBe(0);
        expect(RAW).toContain("## Deficits and why");
        expect(RAW).toMatch(/\*\*Reddit — zero qualifying posts/);
    });

    it("records how X and LinkedIn dates were derived rather than read", () => {
        expect(RAW).toMatch(/snowflake/i);
        expect(RAW).toMatch(/activity URN/i);
    });

    it("declares a rejection log", () => {
        expect(RAW).toContain("## Rejection log");
    });

    it("records that engagement counts are time-sensitive", () => {
        expect(RAW).toMatch(/point-in-time|time-sensitive/i);
    });
});
