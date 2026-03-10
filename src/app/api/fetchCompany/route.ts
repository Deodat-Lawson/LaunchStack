import { NextResponse } from "next/server";
import { db } from "../../../server/db/index";
import { company, users } from "../../../server/db/schema";
import { eq, and } from "drizzle-orm";
import * as console from "console";
import { auth } from "@clerk/nextjs/server";


export async function GET() {
    try {
        const { userId } = await auth();
        if (!userId) {
            return NextResponse.json({
                success: false,
                message: "Unauthorized"
            }, { status: 401 });
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
        }

        const companyId = userInfo.companyId;

        const companies = await db
            .select()
            .from(company)
            .where(and(eq(company.id, Number(companyId))));

        return NextResponse.json(companies, { status: 200 });
    } catch (error: unknown) {
        console.error("Error fetching documents:", error);
        return NextResponse.json(
            { error: "Unable to fetch documents" },
            { status: 500 }
        );
    }
}