import type { WeeklyReviewInput } from "@launchstack/pipelines/vantage/weekly-review-v21";
import type { WeeklyReviewQuery } from "../weekly-review-types";

export async function readCompanyBackground(query: WeeklyReviewQuery, companyId: string) {
    // These fields are already visible to every active member in Workspace General.
    const [row] = await query(
        "SELECT left(description,2000) AS description,industry FROM pdr_ai_v2_company WHERE id=$1::bigint",
        [companyId]
    );
    return boundCompanyBackground(row ?? {});
}

export function boundCompanyBackground(row: Record<string, unknown>) {
    const result: NonNullable<WeeklyReviewInput["companyBackground"]> = {};
    for (const key of ["industry", "description"] as const) {
        const value = row[key];
        if (typeof value !== "string" || !value.trim()) continue;
        const chars = Array.from(value.trim());
        let lower = 0;
        let upper = chars.length;
        while (lower < upper) {
            const middle = Math.ceil((lower + upper) / 2);
            const candidate = { ...result, [key]: chars.slice(0, middle).join("") };
            if (Buffer.byteLength(JSON.stringify(candidate)) <= 2000) lower = middle;
            else upper = middle - 1;
        }
        if (lower) result[key] = chars.slice(0, lower).join("").trimEnd();
    }
    return Object.keys(result).length ? result : undefined;
}
