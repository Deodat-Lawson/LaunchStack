/**
 * Real fit-check verdicts on a benchmark pool, kept on disk beside the
 * recordings: what production's own fit check (src/distribution/judge.ts) said
 * about every company of a pool, asked once.
 *
 * E4's verdicts come from register codes and directory tags. These are a
 * chat model's, with its prompt and its mistakes, so a replay over them shows
 * how the learning shortlist behaves on the verdicts a run really gets.
 *
 * The file holds a verdict and the model's one-sentence reason per company;
 * like the recordings it is never committed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { FitVerdict } from "../../../src/distribution/semantic";
import type { BriefLanguage } from "../e4-whom-to-check/briefs";
import { DEFAULT_CACHE_DIR } from "../lib/recorder";

/** The judge the verdicts were recorded with: the dev configuration's fast route. */
export const JUDGE_ID = "gemini-3.8-flash-fast";

/** Where each Norwegian pool's seller wants its buyers, as a run tells the fit check. */
export const WHERE: Record<string, string> = {
    "brreg-coffee-tea": "Norway",
    "brreg-breweries": "Norway",
    "brreg-dental-bergen": "Bergen, Norway",
};

export interface RecordedVerdicts {
    segment: string;
    briefLanguage: BriefLanguage;
    judge: string;
    /** The pool's fingerprint when it was judged: a re-recorded pool needs new verdicts. */
    poolFingerprint: string;
    /** Pool index → verdict. */
    verdicts: Record<string, FitVerdict>;
    /** A second opinion on some companies, asked in other batches: how stable a verdict is. */
    again?: Record<string, FitVerdict>;
}

export function verdictsFile(
    segment: string,
    language: BriefLanguage,
    judge = JUDGE_ID,
    dir = DEFAULT_CACHE_DIR
): string {
    return path.join(dir, "verdicts", judge, `${segment}.${language}.json`);
}

export function readVerdicts(
    segment: string,
    language: BriefLanguage,
    judge = JUDGE_ID
): RecordedVerdicts | null {
    const file = verdictsFile(segment, language, judge);
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, "utf8")) as RecordedVerdicts;
}

export function writeVerdicts(recorded: RecordedVerdicts): void {
    const file = verdictsFile(recorded.segment, recorded.briefLanguage, recorded.judge);
    mkdirSync(path.dirname(file), { recursive: true });
    // Written beside and moved into place, so a stopped run never leaves half a file.
    const beside = `${file}.part`;
    writeFileSync(beside, JSON.stringify(recorded));
    renameSync(beside, file);
}
