/**
 * A person's edit to one fact — pure, so it runs inside the row lock.
 *
 * Every edit is a `manual_override` fact, which the builder never overwrites
 * and lays back on top of each rebuild. Clearing a value is an edit too: a
 * `manual_override` with status `deprecated` keeps the fact out of the
 * profile even when a source keeps saying it.
 */
import type { CompanyMetadataJSON, MetadataFact, Usage, Visibility } from "./types";

export interface FactEdit {
    /** company.<field> · profile.facts.<key> · profile.summary · people|services|projects|legal.<i>.<field> · markets.<cat>.<i> · policies.<key> */
    path: string;
    value: string;
    /** Label for a new profile fact. */
    label?: string;
    /** Drop the person's edit at this path, so the next assembly shows what the sources say. */
    reset?: boolean;
}

export type EditOutcome =
    | { ok: true; old?: MetadataFact<unknown>; fact: MetadataFact<unknown> }
    | { ok: false; error: string };

const NAMED = ["people", "services", "projects", "legal"] as const;
const KEY_PATTERN = /^[a-z0-9_]{1,64}$/;

function manualFact<T>(
    value: T,
    now: string,
    existing?: { visibility?: Visibility; usage?: Usage },
    removed = false
): MetadataFact<T> {
    return {
        value,
        visibility: existing?.visibility ?? "private",
        usage: existing?.usage ?? "outreach_ok_with_approval",
        confidence: 1,
        priority: "manual_override",
        status: removed ? "deprecated" : "active",
        last_updated: now,
        sources: [{ doc_id: 0, doc_name: "Manual edit", extracted_at: now }],
    };
}

/** The new fact for a path: the typed value, or a removal that keeps the old value to match on. */
function next(
    old: MetadataFact<unknown> | undefined,
    raw: string,
    now: string,
    numeric = false
): MetadataFact<unknown> | null {
    const value = raw.trim();
    if (!value) return old ? manualFact(old.value, now, old, true) : null;
    if (numeric) {
        const n = Number(/\d{4}/.exec(value)?.[0] ?? value);
        if (!Number.isFinite(n)) return null;
        return manualFact(n, now, old);
    }
    return manualFact(value, now, old);
}

/**
 * Remove a person's edit at a path, in place. Returns false when there is no
 * edit there. The sources' value comes back on the next assembly.
 */
export function resetFactEdit(metadata: CompanyMetadataJSON, path: string): boolean {
    const [section, a, b] = path.split(".");
    const isEdit = (f: MetadataFact<unknown> | undefined) => f?.priority === "manual_override";
    const drop = <T extends object>(holder: T | undefined, key: string): boolean => {
        const record = holder as Record<string, MetadataFact<unknown> | undefined> | undefined;
        if (!record || !isEdit(record[key])) return false;
        delete record[key];
        return true;
    };
    if (section === "company" && a) return drop(metadata.company, a);
    if (section === "policies" && a) return drop(metadata.policies, a);
    if (section === "profile" && a === "facts" && b) return drop(metadata.profile?.facts, b);
    if (section === "profile" && a === "summary") return drop(metadata.profile, "summary");
    if (
        (section === "people" ||
            section === "services" ||
            section === "projects" ||
            section === "legal") &&
        a &&
        b
    ) {
        const list = metadata[section] as Array<Record<string, MetadataFact<unknown> | undefined>>;
        const entry = list[Number(a)];
        if (!entry || !drop(entry, b)) return false;
        if (!entry.name) list.splice(Number(a), 1);
        return true;
    }
    return false;
}

/** Apply one edit in place. */
export function applyFactEdit(
    metadata: CompanyMetadataJSON,
    edit: FactEdit,
    now: Date = new Date()
): EditOutcome {
    const at = now.toISOString();
    if (edit.reset)
        return resetFactEdit(metadata, edit.path)
            ? { ok: true, fact: manualFact("", at, undefined, true) }
            : { ok: false, error: "There is no edit to undo there" };
    const [section, a, b, ...rest] = edit.path.split(".");
    if (rest.length) return { ok: false, error: `Unsupported path: ${edit.path}` };

    if (section === "company" && a && !b) {
        const old = metadata.company[a];
        const fact = next(old, edit.value, at, a === "founded_year");
        if (!fact) return { ok: false, error: old ? "Not a year" : "Nothing to remove" };
        metadata.company[a] = fact;
        return { ok: true, old, fact };
    }

    if (section === "profile" && a === "facts" && b) {
        if (!KEY_PATTERN.test(b))
            return { ok: false, error: "A fact key is lowercase letters, digits and _" };
        const facts = (metadata.profile ??= {}).facts ?? {};
        const old = facts[b];
        const fact = next(old, edit.value, at);
        if (!fact) return { ok: false, error: "Nothing to remove" };
        const label = edit.label?.trim() ? edit.label.trim() : old?.label;
        if (!label) return { ok: false, error: "A new fact needs a label" };
        // Profile facts are text; a removal keeps the old text so the rebuild can match it.
        const text = typeof fact.value === "string" ? fact.value : "";
        const labeled = { ...fact, value: text, label: label.slice(0, 120) };
        facts[b] = labeled;
        metadata.profile.facts = facts;
        return { ok: true, old, fact: labeled };
    }

    if (section === "profile" && a === "summary" && !b) {
        const profile = (metadata.profile ??= {});
        const old = profile.summary;
        const fact = next(old, edit.value, at);
        if (!fact) return { ok: false, error: "Nothing to remove" };
        profile.summary = fact as MetadataFact;
        return { ok: true, old, fact };
    }

    if (section && (NAMED as readonly string[]).includes(section) && a !== undefined && b) {
        const list = (
            metadata as unknown as Record<string, Array<Record<string, MetadataFact<unknown>>>>
        )[section];
        const idx = Number(a);
        if (!list || !Number.isInteger(idx) || idx < 0 || idx >= list.length)
            return { ok: false, error: `Invalid ${section} index` };
        if (b === "subprojects") return { ok: false, error: `Unsupported path: ${edit.path}` };
        // A name is what matches an entry to its sources on every rebuild; it can be
        // removed (the entry leaves the profile) but not retyped.
        if (b === "name" && edit.value.trim())
            return { ok: false, error: "A name comes from the sources; remove the entry instead" };
        const entry = list[idx]!;
        const old = entry[b];
        const fact = next(old, edit.value, at);
        if (!fact) return { ok: false, error: "Nothing to remove" };
        entry[b] = fact;
        return { ok: true, old, fact };
    }

    if (
        section === "markets" &&
        (a === "primary" || a === "verticals" || a === "geographies") &&
        b
    ) {
        const list = metadata.markets[a];
        const idx = Number(b);
        if (!list || !Number.isInteger(idx) || idx < 0 || idx >= list.length)
            return { ok: false, error: "Invalid markets index" };
        const old = list[idx];
        const fact = next(old, edit.value, at);
        if (!fact) return { ok: false, error: "Nothing to remove" };
        list[idx] = fact as MetadataFact;
        return { ok: true, old, fact };
    }

    if (section === "policies" && a && !b) {
        const old = metadata.policies[a];
        const fact = next(old, edit.value, at);
        if (!fact) return { ok: false, error: "Nothing to remove" };
        metadata.policies[a] = fact as MetadataFact;
        return { ok: true, old, fact };
    }

    return { ok: false, error: `Unsupported path: ${edit.path}` };
}
