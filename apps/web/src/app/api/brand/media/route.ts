// POST /api/brand/media — multipart `file`: store an image for a post (any member)
import type { NextRequest } from "next/server";

import { saveBrandMedia, toMediaView } from "~/server/brand/media";

import { brandPublishContext, brandT, error, handleBrandError, json } from "../_http";

export async function POST(request: NextRequest) {
    const auth = await brandPublishContext(request);
    if (!auth.ok) return auth.response;
    try {
        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            return error(brandT(request)("sendAsFile"), 400);
        }
        const file = form.get("file");
        if (!(file instanceof File)) return error(brandT(request)("pickImage"), 400);
        const row = await saveBrandMedia({
            companyId: auth.ctx.companyId,
            userId: auth.ctx.userId,
            file,
        });
        return json({ media: toMediaView(row) }, 201);
    } catch (err) {
        return handleBrandError("POST media", err, request);
    }
}
