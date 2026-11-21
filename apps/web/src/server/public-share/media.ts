/**
 * The media viewer's data for a public link: the same pairing as the
 * workspace's `/api/documents/:id/media` (`~/server/media-preview`), with
 * three differences.
 *
 * - The other half of the pair (the recording behind a transcript, or the
 *   transcript made from a recording) must sit in the shared file's own
 *   folder and workspace. Anything else reads as missing.
 * - Every URL is under the token (`/media/content`, `/media/transcript`);
 *   the client never learns, or sends, a document id. Ids read as 0.
 * - No translations: making one spends the workspace's model budget, which
 *   an anonymous viewer must never do.
 */

import { and, eq } from "drizzle-orm";

import { document } from "@launchstack/store/schema";
import type { MediaPreview } from "~/lib/media-document";
import {
    resolveMediaPreview,
    type MediaDocumentRow,
    type ResolvedMedia,
} from "~/server/media-preview";
import type { ResolvedPublicLink } from "~/server/workspace/public-links";

import { publicApiBase, type PublicDocumentRow } from "./document";

export async function resolvePublicMedia(
    link: ResolvedPublicLink,
    row: PublicDocumentRow
): Promise<ResolvedMedia | null> {
    const base = publicApiBase(link.token);
    return resolveMediaPreview(
        {
            id: link.documentId,
            title: row.title,
            url: row.url,
            mimeType: row.mimeType,
            ocrMetadata: row.ocrMetadata,
        },
        {
            where: and(eq(document.companyId, link.companyId), eq(document.category, row.category)),
            playbackUrl: () => `${base}/media/content`,
        }
    );
}

/** The preview as a public viewer gets it: no ids, no translations. */
export function publicMediaPreview(resolved: ResolvedMedia): MediaPreview {
    const { preview } = resolved;
    return {
        ...preview,
        documentId: 0,
        playback:
            preview.playback?.type === "file"
                ? { ...preview.playback, documentId: 0 }
                : preview.playback,
        transcript: preview.transcript
            ? { ...preview.transcript, documentId: 0, translations: [] }
            : null,
    };
}

export type { MediaDocumentRow };
