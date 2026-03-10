import { NextResponse } from "next/server";
import { dbCore } from "../../../server/db/core";
import { document, users, fileUploads } from "../../../server/db/schema/base";
import { eq, inArray } from "drizzle-orm";
import { validateRequestBody, UserIdSchema } from "~/lib/validation";
import { auth } from '@clerk/nextjs/server';

/** Extract file id from /api/files/{id} URL so we can look up mimeType from file_uploads */
const FILE_API_ID_REGEX = /\/api\/files\/(\d+)/;

/** Infer mimeType from a file extension found in the title or URL (zero-cost fallback for cloud docs) */
const EXTENSION_TO_MIME: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".odt": "application/vnd.oasis.opendocument.text",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ods": "application/vnd.oasis.opendocument.spreadsheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".odp": "application/vnd.oasis.opendocument.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
    ".html": "text/html",
    ".htm": "text/html",
    ".md": "text/markdown",
};

const EXTENSION_REGEX = /(\.[a-z0-9]+)(?:\?|#|$)/i;
function inferMimeFromName(name: string): string | undefined {
    const match = EXTENSION_REGEX.exec(name);
    if (!match?.[1]) return undefined;
    return EXTENSION_TO_MIME[match[1].toLowerCase()];
}

export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, UserIdSchema);
        if (!validation.success) {
            return validation.response;
        }

        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json(
                { error: "Invalid user." },
                { status: 400 }
            );
        }

        const [userInfo] = await dbCore
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "Invalid user." },
                { status: 400 }
            );
        }

        const companyId = userInfo.companyId;

        const docs = await dbCore
            .select()
            .from(document)
            .where(eq(document.companyId, companyId));

        // Enrich with mimeType from file_uploads when document URL is /api/files/{id}
        // (so preview works for PDFs and other types when stored in DB and url has no extension)
        const fileIds = docs
            .map((d) => {
                const m = FILE_API_ID_REGEX.exec(d.url);
                return m ? parseInt(m[1]!, 10) : null;
            })
            .filter((id): id is number => id !== null);
        const uniqueFileIds = [...new Set(fileIds)];

        let mimeByFileId: Record<number, string> = {};
        if (uniqueFileIds.length > 0) {
            const rows = await dbCore
                .select({ id: fileUploads.id, mimeType: fileUploads.mimeType })
                .from(fileUploads)
                .where(inArray(fileUploads.id, uniqueFileIds));
            mimeByFileId = Object.fromEntries(rows.map((r) => [r.id, r.mimeType]));
        }

        // Convert BigInt fields to numbers for JSON serialization; attach mimeType for viewer
        const serializedDocs = docs.map((doc) => {
            const fileId = FILE_API_ID_REGEX.exec(doc.url)?.[1];
            const mimeFromFile = fileId ? mimeByFileId[parseInt(fileId, 10)] : undefined;
            // Fallback: infer from title/url extension (covers cloud docs with no DB mime)
            const mimeType = mimeFromFile
                ?? inferMimeFromName(doc.title)
                ?? inferMimeFromName(doc.url);
            return {
                ...doc,
                id: Number(doc.id),
                companyId: Number(doc.companyId),
                ...(mimeType && { mimeType }),
            };
        });

        return NextResponse.json(serializedDocs, { status: 200 });
    } catch (error: unknown) {
        console.error("Error fetching documents:", error);
        return NextResponse.json(
            { error: "Unable to fetch documents" },
            { status: 500 }
        );
    }
}