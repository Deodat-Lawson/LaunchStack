import { composerFileMime, IMAGE_MAX_BYTES } from "./composerState";

export function normalizeComposerFile(file: File): File {
    const type = composerFileMime(file);
    return type === file.type
        ? file
        : new File([file], file.name, { type, lastModified: file.lastModified });
}

function isHeicFile(file: File): boolean {
    return /^image\/hei[cf](?:-sequence)?$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export function needsComposerImagePreparation(file: File): boolean {
    return (
        isHeicFile(file) ||
        (file.size > IMAGE_MAX_BYTES &&
            ["image/jpeg", "image/png", "image/webp"].includes(composerFileMime(file)))
    );
}

/** Resize browser-decodable still images locally before storage upload. */
export async function resizeComposerImage(file: File): Promise<File> {
    file = normalizeComposerFile(file);
    if (isHeicFile(file)) {
        try {
            // The CSP build decodes on this device without unsafe-eval or remote uploads.
            const { heicTo } = await import("heic-to/csp");
            const jpeg = await heicTo({ blob: file, type: "image/jpeg", quality: 0.9 });
            if (!jpeg.size) throw new Error("The converted image is empty.");
            const name = /\.hei[cf]$/i.test(file.name)
                ? file.name.replace(/\.hei[cf]$/i, ".jpg")
                : `${file.name}.jpg`;
            file = new File([jpeg], name, { type: "image/jpeg", lastModified: file.lastModified });
        } catch {
            throw new Error(
                `“${file.name}” could not be converted from HEIC. Export it as JPEG or PNG, then attach it again.`
            );
        }
    }
    if (
        file.size <= IMAGE_MAX_BYTES ||
        !["image/jpeg", "image/png", "image/webp"].includes(file.type)
    )
        return file;
    if (typeof createImageBitmap !== "function")
        throw new Error(
            `“${file.name}” exceeds 10 MiB and this browser cannot resize it. Resize it before attaching.`
        );
    const bitmap = await createImageBitmap(file);
    try {
        let ratio = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
        for (let attempt = 0; attempt < 5; attempt++) {
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
            canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
            const context = canvas.getContext("2d");
            if (!context) throw new Error("Image resizing is unavailable in this browser.");
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob>((resolve, reject) =>
                canvas.toBlob(
                    result =>
                        result ? resolve(result) : reject(new Error("Image resizing failed.")),
                    file.type,
                    Math.max(0.55, 0.9 - attempt * 0.08)
                )
            );
            if (blob.size <= IMAGE_MAX_BYTES)
                return new File([blob], file.name, {
                    type: blob.type,
                    lastModified: file.lastModified,
                });
            ratio *= 0.7;
        }
        throw new Error(
            `“${file.name}” could not be resized below 10 MiB. Resize it before attaching.`
        );
    } finally {
        bitmap.close();
    }
}
