import { RecipientSchema } from "./types.js";
/**
 * Deliberately permissive: this is a *shape* check to catch obvious typos, not
 * an RFC 5322 implementation. `validators.ts` owns the authoritative check and
 * both share this regex so ingestion and validation can never disagree.
 */
export const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;
export function looksLikeEmail(value) {
    return EMAIL_RE.test(value.trim());
}
/** Lowercase + trim. Address comparison is case-insensitive in practice. */
export function normalizeEmail(value) {
    return value.trim().toLowerCase();
}
function clean(value) {
    const v = (value ?? "").trim();
    return v.length > 0 ? v : null;
}
function toRecipient(input) {
    return RecipientSchema.parse({
        email: normalizeEmail(input.email),
        name: clean(input.name),
        company: clean(input.company),
        contextNotes: clean(input.contextNotes),
        vars: input.vars ?? {},
    });
}
/* ──────────────────────────────────────────────────────────────
 * Pasted list
 * ────────────────────────────────────────────────────────────── */
/** `Ada Lovelace <ada@example.com>` → name + address. */
const ANGLE_RE = /^\s*(.*?)\s*<\s*([^<>]+?)\s*>\s*$/;
/**
 * Parse a pasted blob of addresses. Accepts one per line or several separated
 * by commas/semicolons, with or without a display name.
 */
export function parsePastedRecipients(text) {
    const recipients = [];
    const skipped = [];
    const lines = (text ?? "").split(/\r?\n/);
    let row = 0;
    for (const line of lines) {
        row++;
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Only split on comma/semicolon when the line isn't a single "Name <addr>",
        // so a display name containing a comma survives.
        const parts = ANGLE_RE.test(trimmed)
            ? [trimmed]
            : trimmed
                  .split(/[,;]+/)
                  .map(p => p.trim())
                  .filter(Boolean);
        for (const part of parts) {
            const angle = ANGLE_RE.exec(part);
            const name = angle ? clean(angle[1]) : null;
            const address = angle ? (angle[2] ?? "") : part;
            if (!looksLikeEmail(address)) {
                skipped.push({ row, reason: "not a valid email address", raw: part });
                continue;
            }
            recipients.push(toRecipient({ email: address, name }));
        }
    }
    return { recipients, skipped };
}
/* ──────────────────────────────────────────────────────────────
 * CSV
 * ────────────────────────────────────────────────────────────── */
/**
 * Minimal RFC-4180 line splitter: honours double quotes and "" escapes.
 * A dependency-free parser is enough for a contact list and avoids adding a
 * package for one input path.
 */
function splitCsvLine(line) {
    const out = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                if (line[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                field += ch;
            }
        } else if (ch === '"') {
            inQuotes = true;
        } else if (ch === ",") {
            out.push(field);
            field = "";
        } else {
            field += ch;
        }
    }
    out.push(field);
    return out.map(f => f.trim());
}
/** Header aliases → canonical field. Case/space/underscore-insensitive. */
const HEADER_ALIASES = {
    email: "email",
    emailaddress: "email",
    mail: "email",
    name: "name",
    fullname: "name",
    contact: "name",
    contactname: "name",
    company: "company",
    companyname: "company",
    organisation: "company",
    organization: "company",
    org: "company",
    notes: "notes",
    contextnotes: "notes",
    context: "notes",
};
function canonicalHeader(raw) {
    return raw.toLowerCase().replace(/[\s_-]+/g, "");
}
/**
 * Parse a CSV with a header row. Unmapped columns are preserved as per-recipient
 * merge `vars`, so a template can use `{{industry}}` if the sheet had one.
 */
export function parseRecipientCsv(text) {
    const recipients = [];
    const skipped = [];
    const lines = (text ?? "").split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length === 0) return { recipients, skipped };
    const header = splitCsvLine(lines[0]);
    const mapped = header.map(h => HEADER_ALIASES[canonicalHeader(h)] ?? null);
    if (!mapped.includes("email")) {
        return {
            recipients,
            skipped: [{ row: 1, reason: "no email column found in header", raw: lines[0] }],
        };
    }
    for (let i = 1; i < lines.length; i++) {
        const raw = lines[i];
        const cells = splitCsvLine(raw);
        const rec = {};
        const vars = {};
        header.forEach((h, idx) => {
            const value = cells[idx] ?? "";
            const target = mapped[idx];
            if (target) rec[target] = value;
            else if (value.trim() && h.trim()) vars[canonicalHeader(h)] = value.trim();
        });
        const email = rec.email ?? "";
        if (!looksLikeEmail(email)) {
            skipped.push({
                row: i + 1,
                reason: email.trim() ? "not a valid email address" : "empty email cell",
                raw,
            });
            continue;
        }
        recipients.push(
            toRecipient({
                email,
                name: rec.name,
                company: rec.company,
                contextNotes: rec.notes,
                vars,
            })
        );
    }
    return { recipients, skipped };
}
/** One line of grounded context per prospect, used to personalize the email. */
export function prospectContextNotes(p) {
    const bits = [
        p.categories?.length ? p.categories.slice(0, 3).join(", ") : null,
        p.address ?? null,
        p.website ?? null,
        p.rationale ?? null,
    ].filter(b => Boolean(b?.trim()));
    return bits.join(" · ");
}
/**
 * Convert prospector results into recipients.
 *
 * `emailByName` supplies addresses a human has already researched, keyed by the
 * prospect's name. Anything absent from it lands in `needsEmail`.
 */
export function recipientsFromProspects(prospects, emailByName = {}) {
    const recipients = [];
    const skipped = [];
    const needsEmail = [];
    prospects.forEach((p, i) => {
        const contextNotes = prospectContextNotes(p);
        const supplied = emailByName[p.name] ?? emailByName[p.name?.trim() ?? ""];
        if (!supplied) {
            needsEmail.push({ prospect: p, contextNotes });
            return;
        }
        if (!looksLikeEmail(supplied)) {
            skipped.push({
                row: i + 1,
                reason: `supplied address for "${p.name}" is not valid`,
                raw: supplied,
            });
            return;
        }
        recipients.push(
            toRecipient({
                email: supplied,
                company: p.name,
                contextNotes,
                vars: p.website ? { website: p.website } : {},
            })
        );
    });
    return { recipients, skipped, needsEmail };
}
/* ──────────────────────────────────────────────────────────────
 * Combining sources
 * ────────────────────────────────────────────────────────────── */
/**
 * Merge several ingest results, de-duplicating by address. The first occurrence
 * wins, and later duplicates are reported rather than silently dropped — a
 * duplicate usually means someone pasted a list twice.
 */
export function combineRecipients(...results) {
    const seen = new Map();
    const skipped = [];
    for (const result of results) {
        skipped.push(...result.skipped);
        for (const r of result.recipients) {
            if (seen.has(r.email)) {
                skipped.push({
                    row: 0,
                    reason: "duplicate address (kept the first occurrence)",
                    raw: r.email,
                });
                continue;
            }
            seen.set(r.email, r);
        }
    }
    return { recipients: [...seen.values()], skipped };
}
//# sourceMappingURL=recipients.js.map
