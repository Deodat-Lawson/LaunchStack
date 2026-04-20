/**
 * Upload-accepted file types for the employer document upload flow.
 * Derived from the ingestion layer; excludes email (no adapter) so only
 * types that can be meaningfully processed are allowed.
 */

import {
  EXTENSION_TO_SOURCE_TYPE,
  MIME_TO_SOURCE_TYPE,
} from "~/lib/ingestion/types";

const EMAIL_SOURCE = "email";
const UNKNOWN_SOURCE = "unknown";

/** MIME types that have a dedicated ingestion adapter (excludes email). */
export const ACCEPTED_MIME_TYPES: string[] = (
  Object.entries(MIME_TO_SOURCE_TYPE) as [string, string][]
)
  .filter(([, sourceType]) => sourceType !== EMAIL_SOURCE && sourceType !== UNKNOWN_SOURCE)
  .map(([mime]) => mime);

/** File extensions that have a dedicated ingestion adapter (excludes email). */
export const ACCEPTED_EXTENSIONS: string[] = (
  Object.entries(EXTENSION_TO_SOURCE_TYPE) as [string, string][]
)
  .filter(([, sourceType]) => sourceType !== EMAIL_SOURCE && sourceType !== UNKNOWN_SOURCE)
  .map(([ext]) => ext);

/** Value for HTML <input accept=""> attribute. */
export const UPLOAD_ACCEPT_STRING = ACCEPTED_EXTENSIONS.join(",");

/**
 * Returns true if the file is an accepted type for upload (by MIME or extension).
 */
export function isUploadAccepted(file: {
  name: string;
  type?: string;
}): boolean {
  if (file.type && ACCEPTED_MIME_TYPES.includes(file.type)) {
    return true;
  }
  const ext = file.name.includes(".")
    ? file.name.slice(file.name.lastIndexOf(".")).toLowerCase()
    : "";
  return ext !== "" && ACCEPTED_EXTENSIONS.includes(ext);
}
