/**
 * Wire-format version for every contract in this package.
 *
 * Zod object schemas here use default (non-strict) parsing: consumers strip
 * unknown fields instead of rejecting them, so ADDING an optional field is
 * backward compatible and does not bump this version. Renames, removals,
 * type changes, and new REQUIRED fields are breaking and require a bump plus
 * a parallel `v{n}` schema directory until all consumers have moved.
 */
export const PROTOCOL_VERSION = 1 as const;

export type ProtocolVersion = typeof PROTOCOL_VERSION;
