/** Posting to LinkedIn: image uploads, the post itself, and taking it down. */
import type { PublishMedia } from "../types";
import { escapeLinkedInCommentary } from "./commentary";
import { decodeId, encodeUrn, linkedInContext, linkedInRequest, readJson } from "./http";
import { LinkedInApiError, type LinkedInClientOptions } from "./types";

/** LinkedIn's Images API takes JPG, PNG and GIF; WebP and the rest are refused. */
const LINKEDIN_IMAGE_TYPES: Record<string, string> = {
    "image/jpeg": "image/jpeg",
    "image/jpg": "image/jpeg",
    "image/pjpeg": "image/jpeg",
    "image/png": "image/png",
    "image/gif": "image/gif",
};

/** MultiImage posts carry 2–20 images. */
export const LINKEDIN_MAX_IMAGES = 20;
const ALT_TEXT_MAX = 4086;

function linkedInMimeType(image: PublishMedia): string {
    const mime = LINKEDIN_IMAGE_TYPES[image.mimeType.trim().toLowerCase()];
    if (!mime) {
        const name = image.filename ? `${image.filename} is ${image.mimeType}` : image.mimeType;
        throw new LinkedInApiError(
            `LinkedIn takes JPG, PNG or GIF images (${name} is not one).`,
            415,
            false,
            false
        );
    }
    return mime;
}

/** Initialize, upload and return the `urn:li:image:…` for one image owned by `ownerUrn`. */
export async function uploadLinkedInImage(
    opts: LinkedInClientOptions & { ownerUrn: string; image: PublishMedia }
): Promise<string> {
    const mimeType = linkedInMimeType(opts.image);
    const ctx = linkedInContext(opts);

    const init = await linkedInRequest(ctx, {
        method: "POST",
        path: "/rest/images?action=initializeUpload",
        json: { initializeUploadRequest: { owner: opts.ownerUrn } },
        what: "start the image upload",
    });
    const data = await readJson<{ value?: { uploadUrl?: string; image?: string } }>(init);
    const uploadUrl = data?.value?.uploadUrl?.trim();
    const imageUrn = data?.value?.image?.trim();
    if (!uploadUrl || !imageUrn) {
        throw new LinkedInApiError(
            "LinkedIn did not return an upload URL for the image.",
            init.status,
            false,
            true
        );
    }

    const put = await linkedInRequest(ctx, {
        method: "PUT",
        // A stand-in may answer with a path; LinkedIn answers with an absolute URL.
        path: new URL(uploadUrl, `${ctx.base}/`).toString(),
        body: opts.image.data,
        headers: { "Content-Type": mimeType },
        versioned: false,
        what: "upload the image",
    });
    await put.text().catch(() => "");
    return imageUrn;
}

/**
 * Create a post as `authorUrn` (a member or a Page): text, plus one image
 * (`content.media`) or 2–20 (`content.multiImage`). Images are validated
 * before anything is uploaded, then uploaded with the author as owner. The
 * commentary is escaped for LinkedIn's little text format.
 */
export async function createLinkedInPost(
    opts: LinkedInClientOptions & { authorUrn: string; text: string; media?: PublishMedia[] }
): Promise<{ postUrn: string; postUrl: string }> {
    const media = opts.media ?? [];
    if (media.length > LINKEDIN_MAX_IMAGES) {
        throw new LinkedInApiError(
            `LinkedIn takes at most ${LINKEDIN_MAX_IMAGES} images in one post (this one has ${media.length}).`,
            400,
            false,
            false
        );
    }
    media.forEach(linkedInMimeType);

    const ctx = linkedInContext(opts);
    const images: Array<{ id: string; altText?: string }> = [];
    for (const image of media) {
        const id = await uploadLinkedInImage({ ...opts, ownerUrn: opts.authorUrn, image });
        const altText = image.alt?.trim().slice(0, ALT_TEXT_MAX);
        images.push(altText ? { id, altText } : { id });
    }

    const body: Record<string, unknown> = {
        author: opts.authorUrn,
        commentary: escapeLinkedInCommentary(opts.text),
        visibility: "PUBLIC",
        distribution: {
            feedDistribution: "MAIN_FEED",
            targetEntities: [],
            thirdPartyDistributionChannels: [],
        },
        lifecycleState: "PUBLISHED",
        isReshareDisabledByAuthor: false,
    };
    if (images.length === 1) body.content = { media: images[0] };
    else if (images.length > 1) body.content = { multiImage: { images } };

    const res = await linkedInRequest(ctx, {
        method: "POST",
        path: "/rest/posts",
        json: body,
        what: "publish the post",
    });
    const header = decodeId(res.headers.get("x-restli-id"));
    const postUrn = header ?? decodeId((await readJson<{ id?: string }>(res))?.id ?? null);
    if (!postUrn) {
        // The post exists; retrying would publish it twice.
        throw new LinkedInApiError(
            "LinkedIn accepted the post but did not return its id.",
            res.status,
            false,
            false
        );
    }
    return { postUrn, postUrl: linkedInPostUrl(postUrn) };
}

/** Delete a post. Already gone (404) counts as done. */
export async function deleteLinkedInPost(
    opts: LinkedInClientOptions & { postUrn: string }
): Promise<void> {
    const ctx = linkedInContext(opts);
    const res = await linkedInRequest(ctx, {
        method: "DELETE",
        path: `/rest/posts/${encodeUrn(opts.postUrn)}`,
        headers: { "X-RestLi-Method": "DELETE" },
        allow: [404],
        what: "delete the post",
    });
    await res.text().catch(() => "");
}

/** Public URL for a post URN. */
export function linkedInPostUrl(postUrn: string): string {
    return `https://www.linkedin.com/feed/update/${postUrn}`;
}
