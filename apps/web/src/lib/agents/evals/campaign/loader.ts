/**
 * Fixture loading and EvalContext construction.
 *
 * Fixtures live outside `src/` as plain data so they can be authored and
 * reviewed without touching TypeScript:
 *
 *   fixtures/companies/<company-id>/company.json
 *   fixtures/companies/<company-id>/docs/*.md
 *   fixtures/evaluations/*.json
 *
 * Loading is synchronous and filesystem-only — no network, so it is safe to
 * call from tests.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import {
    CompanyFixtureSchema,
    FixtureSchema,
    type CompanyFixture,
    type EvalContext,
    type Fixture,
    type SourceFact,
} from "@schema";

/**
 * Locate the repository root by walking up until an ancestor contains
 * `fixtures/companies`.
 *
 * Deliberately not a fixed number of `..` segments: this module sits at a
 * different depth depending on the repository layout it is checked out in
 * (`src/lib/agents/evals/campaign` in the flat layout, five levels down;
 * `apps/web/src/lib/agents/evals/campaign` in the monorepo layout, seven).
 * Counting levels silently resolves to the wrong directory on the other layout.
 */
function findRepoRoot(start: string): string {
    let dir = start;
    for (let i = 0; i < 12; i++) {
        if (existsSync(join(dir, "fixtures", "companies"))) return dir;
        const parent = dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(
        `[eval-loader] could not locate the repository root from ${start}: ` +
            "no ancestor directory contains fixtures/companies"
    );
}

/** Repository root, resolved from this file's location. */
export const REPO_ROOT = findRepoRoot(__dirname);
export const COMPANIES_DIR = join(REPO_ROOT, "fixtures", "companies");
export const EVALUATIONS_DIR = join(REPO_ROOT, "fixtures", "evaluations");

function readJson(path: string): unknown {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function listDirs(dir: string): string[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir).filter(name => statSync(join(dir, name)).isDirectory());
}

function walkFiles(dir: string, ext: string): string[] {
    if (!existsSync(dir)) return [];
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) out.push(...walkFiles(full, ext));
        else if (entry.endsWith(ext)) out.push(full);
    }
    return out;
}

/** Company ids present on disk. */
export function listCompanyIds(): string[] {
    return listDirs(COMPANIES_DIR).sort();
}

/**
 * Load and validate one company fixture. Throws with the company id in the
 * message if validation fails, so test output identifies the offender.
 */
export function loadCompanyFixture(companyId: string): CompanyFixture {
    const path = join(COMPANIES_DIR, companyId, "company.json");
    if (!existsSync(path)) {
        throw new Error(`[eval-loader] no company.json for "${companyId}" at ${path}`);
    }
    const parsed = CompanyFixtureSchema.safeParse(readJson(path));
    if (!parsed.success) {
        throw new Error(
            `[eval-loader] company "${companyId}" failed CompanyFixtureSchema: ${JSON.stringify(
                parsed.error.flatten()
            )}`
        );
    }
    return parsed.data;
}

export function loadAllCompanyFixtures(): CompanyFixture[] {
    return listCompanyIds().map(loadCompanyFixture);
}

/**
 * Load a company's documents keyed by the fixture-relative path used in
 * `company.json` provenance entries (POSIX-style, e.g. `docs/product-guide.md`).
 */
export function loadCompanyDocuments(companyId: string): Record<string, string> {
    const base = join(COMPANIES_DIR, companyId);
    const out: Record<string, string> = {};
    for (const full of walkFiles(base, ".md")) {
        const rel = relative(base, full).split(sep).join("/");
        out[rel] = readFileSync(full, "utf8");
    }
    return out;
}

/**
 * Load and validate all evaluation fixtures. Each `.json` file may contain a
 * single fixture object or an array of them.
 */
export function loadEvalFixtures(): Fixture[] {
    const files = walkFiles(EVALUATIONS_DIR, ".json").sort();
    const out: Fixture[] = [];
    for (const path of files) {
        const raw = readJson(path);
        const entries = Array.isArray(raw) ? raw : [raw];
        entries.forEach((entry, i) => {
            const parsed = FixtureSchema.safeParse(entry);
            if (!parsed.success) {
                throw new Error(
                    `[eval-loader] fixture ${path}[${i}] failed FixtureSchema: ${JSON.stringify(
                        parsed.error.flatten()
                    )}`
                );
            }
            out.push(parsed.data);
        });
    }
    return out;
}

/** Index source facts by id. */
export function indexFacts(company: CompanyFixture): Record<string, SourceFact> {
    return Object.fromEntries((company.sourceFacts ?? []).map(f => [f.id, f]));
}

/**
 * Build the context a deterministic assertion receives.
 * `company` may be supplied to avoid re-reading disk in loops.
 */
export function buildEvalContext(fixture: Fixture, company?: CompanyFixture): EvalContext {
    const resolved = company ?? loadCompanyFixture(fixture.companyId);
    return {
        fixture,
        company: resolved,
        documents: loadCompanyDocuments(fixture.companyId),
        factsById: indexFacts(resolved),
    };
}
