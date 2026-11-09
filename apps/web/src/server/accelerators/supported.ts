import type { IsSupportedAccelerator } from "@launchstack/pipelines/accelerators";

/**
 * Temporary stand-in until the similar-companies work (Workstream 3) merges.
 * TODO(merge): replace with `isSupportedAccelerator` from
 * `@launchstack/pipelines/accelerators/db`. Under fit-v1 the portfolio dimension
 * does not apply either way, so this stand-in changes no score.
 */
export const isSupportedAccelerator: IsSupportedAccelerator = () => Promise.resolve(false);
