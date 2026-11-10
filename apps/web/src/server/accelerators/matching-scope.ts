/**
 * The Programs that Match Programs scores. A matching run asks the model about every
 * Program in one request, which does not scale to the full catalogue; until matching
 * runs in batches it covers these twelve. Every other imported Program is still
 * listed and shows "Not matched yet".
 */
const MATCHED_PROGRAMS: Record<string, true> = {
    "500-global": true,
    "a16z-speedrun": true,
    "abovea-startup-accelerator": true,
    alchemist: true,
    antler: true,
    "berkeley-skydeck": true,
    "entrepreneurs-first": true,
    hax: true,
    masschallenge: true,
    "south-park-commons": true,
    "techstars-london": true,
    "y-combinator": true,
};

export function isMatchedProgram(programId: string): boolean {
    return Object.hasOwn(MATCHED_PROGRAMS, programId);
}
