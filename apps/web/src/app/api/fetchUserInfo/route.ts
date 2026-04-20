import { NextResponse } from "next/server";
import { dbCore } from "../../../server/db/core";
import { company, users } from "../../../server/db/schema/base";
import { and, eq } from "drizzle-orm";
import { auth } from '@clerk/nextjs/server'

export async function POST() {
    try {
        const { userId } = await auth()
        if (!userId) {
            return NextResponse.json({ error: "Invalid user." }, { status: 400 });
        }

        const [userInfo] = await dbCore
            .select()
            .from(users)
            .where(eq(users.userId, userId));

        if (!userInfo) {
            return NextResponse.json({ error: "Invalid user." }, { status: 400 });
        }

        const companyId = userInfo.companyId;

        const [companyRecord] = await dbCore
            .select()
            .from(company)
            .where(and(eq(company.id, Number(companyId))));

        if (!companyRecord) {
            return NextResponse.json(
                { error: "Company not found" },
                { status: 404 }
            );
        }

        const submissionDate = new Date(userInfo.createdAt).toLocaleString("en-US", {
            dateStyle: "medium",
            timeStyle: "short",
        });

        // Convert BigInt fields to numbers for JSON serialization
        const serializedUserInfo = {
            ...userInfo,
            companyId: Number(userInfo.companyId),
        };

        return NextResponse.json(
            {
                ...serializedUserInfo,
                company: companyRecord.name,
                submissionDate: submissionDate,
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error("Error fetching user and company info:", error);
        return NextResponse.json(
            { error: "Unable to fetch user and company info" },
            { status: 500 }
        );
    }
}
