import { randomUUID } from "node:crypto";
import { encryptSecret, decryptSecret } from "@launchstack/store/crypto";
import { weeklyReviewDatabase } from "../weekly-review-service";
import {
    WeeklyReviewConflict,
    type WeeklyReviewActor,
    type WeeklyReviewQuery,
} from "../weekly-review-types";
import { SettingsInput } from "./contracts";
export const settingsAAD = (a: WeeklyReviewActor) =>
    "vantage-v2-settings:" + a.companyId + ":" + a.userId;
export async function eligiblePersonas(q: WeeklyReviewQuery, a: WeeklyReviewActor) {
    return q(
        "SELECT id,display_name AS name,role FROM pdr_ai_v2_collab_agent_persona WHERE company_id=$1::bigint AND archived=false",
        [a.companyId]
    );
}
export async function loadSettings(q: WeeklyReviewQuery, a: WeeklyReviewActor) {
    const rows = await q(
        "SELECT ciphertext FROM pdr_ai_v2_vantage_v2_settings WHERE company_id=$1::bigint AND owner_id=$2",
        [a.companyId, a.userId]
    );
    return rows[0]
        ? SettingsInput.parse(JSON.parse(decryptSecret(String(rows[0].ciphertext), settingsAAD(a))))
        : { goals: [], personaIds: [] };
}
export async function getVantageV2Settings(a: WeeklyReviewActor) {
    return weeklyReviewDatabase.transaction(async q => ({
        ...(await loadSettings(q, a)),
        personas: await eligiblePersonas(q, a),
    }));
}
export async function putVantageV2Settings(a: WeeklyReviewActor, input: unknown) {
    const data = SettingsInput.parse(input);
    return weeklyReviewDatabase.transaction(async q => {
        const personas = await eligiblePersonas(q, a);
        if (data.personaIds.some(id => !personas.some(p => p.id === id)))
            throw new WeeklyReviewConflict("task_assignee_invalid", 400);
        await q(
            "INSERT INTO pdr_ai_v2_vantage_v2_settings(id,company_id,owner_id,ciphertext) VALUES($1::uuid,$2::bigint,$3,$4) ON CONFLICT(company_id,owner_id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext",
            [
                randomUUID(),
                a.companyId,
                a.userId,
                encryptSecret(JSON.stringify(data), settingsAAD(a)).ciphertext,
            ]
        );
        return { ...data, personas };
    });
}
