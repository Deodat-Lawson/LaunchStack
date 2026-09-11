/**
 * Wire schemas for the two Google endpoints this package speaks to: the OAuth
 * 2.0 token endpoint and the Drive v3 REST API. Every response is validated
 * here so a contract drift on Google's side fails loudly at the boundary,
 * never as an undefined deep in the sync pipeline.
 */
import { z } from "zod";

/** OAuth token endpoint — authorization-code exchange and refresh. */
export const tokenResponseSchema = z.object({
    access_token: z.string().min(1),
    expires_in: z.number().int().positive(),
    // Present on the initial code exchange (access_type=offline), absent on
    // refresh responses.
    refresh_token: z.string().min(1).optional(),
    scope: z.string().optional(),
    token_type: z.string().optional(),
    // Present when the openid/email scopes were requested.
    id_token: z.string().optional(),
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

/** OAuth error body — `invalid_grant` here means the user revoked us. */
export const oauthErrorSchema = z.object({
    error: z.string(),
    error_description: z.string().optional(),
});

/**
 * Drive file metadata, restricted to the fields the sync pipeline asks for.
 * `headRevisionId` and `md5Checksum` exist only for binary content (our
 * .docx/.pdf case); a file converted to a native Google Doc loses both, and
 * the monotonic `version` counter takes over as the change marker.
 */
export const driveFileMetadataSchema = z.object({
    id: z.string().min(1),
    name: z.string().optional(),
    mimeType: z.string().min(1),
    trashed: z.boolean().optional(),
    headRevisionId: z.string().optional(),
    version: z.string().optional(),
    md5Checksum: z.string().optional(),
    modifiedTime: z.string().optional(),
    size: z.string().optional(),
    webViewLink: z.string().optional(),
});
export type DriveFileMetadata = z.infer<typeof driveFileMetadataSchema>;

export const DRIVE_METADATA_FIELDS =
    "id,name,mimeType,trashed,headRevisionId,version,md5Checksum,modifiedTime,size,webViewLink";

export const driveFileListSchema = z.object({
    files: z.array(driveFileMetadataSchema),
});

/** Drive API error body: `{ "error": { "code": 404, "message": "..." } }`. */
export const driveErrorSchema = z.object({
    error: z.object({
        code: z.number().optional(),
        message: z.string().optional(),
        status: z.string().optional(),
    }),
});

export const GOOGLE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const GOOGLE_DOC_MIME = "application/vnd.google-apps.document";
export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const PDF_MIME = "application/pdf";
