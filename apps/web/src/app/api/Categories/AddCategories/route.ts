import { NextResponse } from "next/server";
import { db } from "~/server/db/index";
import { users, category } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { validateRequestBody } from "~/lib/validation";
import { auth } from "@clerk/nextjs/server";

const AddCategorySchema = z.object({
    CategoryName: z.string().min(1, "Category name is required").max(256, "Category name is too long"),
});


export async function POST(request: Request) {
    try {
        const validation = await validateRequestBody(request, AddCategorySchema);
        if (!validation.success) {
            return validation.response;
        }

			const { userId } = await auth();
			if (!userId) {
				return NextResponse.json(
					{ error: "Invalid user." },
					{ status: 400 }
				);
			}

        const [userInfo] = await db
            .select()
            .from(users)
				.where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json(
                { error: "Invalid user." },
                { status: 400 }
            );
        } else if (userInfo.role !== "employer" && userInfo.role !== "owner") {
            return NextResponse.json(
                { error: "Invalid user role." },
                { status: 400 }
            );
        }

        const companyId = userInfo.companyId;

        const newCategoryId = await db.insert(category).values({
            name: validation.data.CategoryName,
            companyId: companyId,
        }).returning({ id: category.id });

        return NextResponse.json({ success: true, id: newCategoryId[0], name: validation.data.CategoryName });
    } catch (error: unknown) {
        console.error(error);
        return NextResponse.json({ error }, { status: 500 });
    }
}
