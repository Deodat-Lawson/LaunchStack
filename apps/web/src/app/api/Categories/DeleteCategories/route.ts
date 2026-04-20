import { NextResponse } from "next/server";
import { db } from "../../../../server/db/index";
import { category, users } from "../../../../server/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { validateRequestBody } from "~/lib/validation";
import { z } from "zod";

const DeleteCategorySchema = z.object({
    id: z.number().int().positive("Category ID must be a positive integer"),
});

export async function DELETE(request: Request) {
    try {
        const validation = await validateRequestBody(request, DeleteCategorySchema);
        if (!validation.success) {
            return validation.response;
        }

			const { userId } = await auth();
			if (!userId) {
				return NextResponse.json({ error: "Invalid user." }, { status: 400 });
			}

        const [userInfo] = await db
            .select()
            .from(users)
				.where(eq(users.userId, userId));
        
        if (!userInfo) {
            return NextResponse.json({ error: "Invalid user." }, { status: 400 });
        } else if (userInfo.role !== "employer" && userInfo.role !== "owner") {
            return NextResponse.json({ error: "Invalid user role." }, { status: 400 });
        }

        await db.delete(category).where(eq(category.id, Number(validation.data.id)));

        return NextResponse.json({ success: true }, { status: 200 });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}