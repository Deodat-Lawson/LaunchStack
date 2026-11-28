import { HumanMessage } from "@langchain/core/messages";
import { weeklyReviewDatabase, weeklyReviewServices } from "../weekly-review-service";
import type { VantageTask, VantagePlan } from "./contracts";
import type { WeeklyReviewActor } from "../weekly-review-types";
import { createVantageV2Repository } from "./repository";
import { getVantageV2Settings } from "./settings";
import { decomposeReview } from "./decompose";
import { generateVantageV2Tasks } from "./model-journal";
export const vantageV2Repository = createVantageV2Repository(weeklyReviewDatabase);
const pendingPlans = new Map<string, Promise<{ plan: VantagePlan | null }>>();
export async function createVantageV2Plan(actor: WeeklyReviewActor, id: string) {
    const key = JSON.stringify([actor.companyId, actor.userId, id]);
    const pending = pendingPlans.get(key);
    if (pending) return pending;
    const work = (async () => {
        const existing = await vantageV2Repository.get(actor, id);
        if (existing.plan) return existing;
        const review = await weeklyReviewServices().repository.get(actor, id);
        const settings = await getVantageV2Settings(actor);
        const personas = settings.personas
            .filter(persona => settings.personaIds.includes(String(persona.id)))
            .map(persona => ({
                id: String(persona.id),
                name: String(persona.name).slice(0, 128),
                role: String(persona.role).slice(0, 128),
            }));
        const proposed = await decomposeReview(
            review,
            actor.userId,
            personas,
            settings.goals,
            prompt => generateVantageV2Tasks(actor, id, [new HumanMessage(prompt)])
        );
        return vantageV2Repository.create(actor, id, proposed);
    })();
    pendingPlans.set(key, work);
    try {
        return await work;
    } finally {
        if (pendingPlans.get(key) === work) pendingPlans.delete(key);
    }
}

export async function approveVantageV2Plan(
    actor: WeeklyReviewActor,
    id: string,
    version: number,
    hash: string
) {
    const result = await vantageV2Repository.approve(actor, id, version, hash);
    await wakeQueued(result.plan.tasks);
    return result;
}
export async function actVantageV2Task(actor: WeeklyReviewActor, id: string, input: unknown) {
    const result = await vantageV2Repository.action(actor, id, input);
    await wakeQueued(result.plan.tasks.filter(t => t.id === id));
    return result;
}
async function wakeQueued(tasks: VantageTask[]) {
    const ids = tasks.filter(t => t.status === "queued").map(t => t.id);
    if (ids.length) {
        try {
            const { wakeVantageTasks } = await import("./worker");
            await wakeVantageTasks(ids);
        } catch {
            console.warn("[vantage] task wake unavailable; owner can invoke queued task again");
        }
    }
}
