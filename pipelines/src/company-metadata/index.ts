/**
 * Company profile — the one builder of what a workspace's sources prove about
 * its organisation. Settings › Company, Proposals › Profile, chat's company
 * facts, and the marketing, email and legal pipelines all read what it writes
 * to `company_metadata`.
 *
 *   passages    noise out: reference lists, number tables, chart residue,
 *               boilerplate, repeated overlap, empty placeholders   (pure)
 *   triage      is this source about the organisation?             (rules + model)
 *   extractor   cited facts from one source, quotes checked verbatim (model)
 *   assemble    the profile rebuilt from counted sources + edits   (pure)
 *   synthesize  summary, applicant type, focus areas from the facts (model)
 *   views       the profile as people read it, excerpts numbered   (pure)
 *   build / db  the orchestration and persistence around them
 */

export * from "./types";
export { mergeCompanyMetadata } from "./merger";
export {
    PROFILE_FACT_LABELS,
    countFacts,
    extractSourceFacts,
    groundFact,
    type GenerateStructuredFn,
    type ProfileFactKey,
} from "./extractor";
export { cleanPassages, quoteAppearsIn, type Passage, type RawChunk } from "./passages";
export { sourceKindOf, triageByRules, type SourceKind, type TriageResult } from "./triage";
export {
    applyManualOverrides,
    assembleMetadata,
    diffMetadata,
    factsHash,
    flattenFacts,
} from "./assemble";
export { synthesizeProfile } from "./synthesize";
export {
    MIN_VIEW_CONFIDENCE,
    labelFor,
    numberedFacts,
    profileView,
    type ProfileView,
    type ViewEntry,
    type ViewEvidence,
    type ViewFact,
} from "./views";
export {
    assembleProfile,
    catchUpAndAssemble,
    isSourceFresh,
    readSource,
    recordOverride,
    rebuildProfile,
    refreshForDocument,
    staleDocumentIds,
    type CompanyIdentityHint,
    type ProfileBuildPorts,
    type RebuildResult,
} from "./build";
export {
    getProfileRow,
    isCounted,
    listSourceRows,
    listWorkspaceDocuments,
    BUILD_STUCK_MS,
    finishBuild,
    saveProfileLocked,
    setBuildStatus,
    startBuild,
    startBuildIfIdle,
    type ProfileDocument,
    type ProfileRow,
} from "./db";
export { READER_VERSION } from "./prompts";
export { applyFactEdit, resetFactEdit, type EditOutcome, type FactEdit } from "./edit";
