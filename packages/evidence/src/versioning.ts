/**
 * Supersession over immutable source versions (ADR-005 §2).
 *
 * Versions are never edited in place; a change to a source produces a new
 * version row. These helpers decide which version is current and which are
 * superseded, without touching a database: callers pass the version metadata
 * they already loaded.
 */

/** Metadata of one immutable source version. */
export interface SourceVersionMeta {
  versionId: number;
  /** Monotonic per-source ordinal; the ordering authority for supersession. */
  versionNumber: number;
  /** ISO-8601 creation timestamp. Informational; never used for ordering. */
  createdAt: string;
}

const compareVersions = (a: SourceVersionMeta, b: SourceVersionMeta): number =>
  a.versionNumber - b.versionNumber || a.versionId - b.versionId;

/**
 * Resolves the current version of a source. An explicit `currentVersionId`
 * pointer wins when it matches a listed version; otherwise (missing pointer,
 * or a pointer naming no listed version) the highest `versionNumber` wins,
 * with ties broken by higher `versionId` for determinism. Returns null for
 * an empty list.
 */
export function resolveCurrentVersion(
  versions: readonly SourceVersionMeta[],
  currentVersionId?: number | null,
): SourceVersionMeta | null {
  if (versions.length === 0) return null;
  if (currentVersionId !== undefined && currentVersionId !== null) {
    const explicit = versions.find((v) => v.versionId === currentVersionId);
    if (explicit) return explicit;
  }
  return versions.reduce((best, v) => (compareVersions(v, best) > 0 ? v : best));
}

/**
 * True when `versionId` names a listed version that is not the resolved
 * current one. Unknown version ids are not superseded — they are simply not
 * part of this source's history.
 */
export function isSuperseded(
  versions: readonly SourceVersionMeta[],
  versionId: number,
  currentVersionId?: number | null,
): boolean {
  if (!versions.some((v) => v.versionId === versionId)) return false;
  const current = resolveCurrentVersion(versions, currentVersionId);
  return current !== null && current.versionId !== versionId;
}

/**
 * The source's version history ordered oldest → newest by `versionNumber`
 * (ties broken by `versionId`). Returns a new array; the input is never
 * mutated.
 */
export function supersessionChain(
  versions: readonly SourceVersionMeta[],
): SourceVersionMeta[] {
  return [...versions].sort(compareVersions);
}
