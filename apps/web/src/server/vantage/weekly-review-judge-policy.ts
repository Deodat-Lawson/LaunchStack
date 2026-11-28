import { z } from "zod";

const JudgeDeploymentSchema = z
    .object({
        generationModel: z.string().min(1).max(300),
        judgeModel: z.string().min(1).max(300),
        independent: z.boolean(),
        sharedDeploymentAllowed: z.boolean(),
    })
    .strict();

export type WeeklyReviewJudgeDeployment = z.infer<typeof JudgeDeploymentSchema>;

export function allowSharedJudgeDeployment(
    environment: Record<string, string | undefined> = process.env
): boolean {
    return environment.VANTAGE_ALLOW_SHARED_JUDGE_DEPLOYMENT === "true";
}

export function judgeDeploymentDiagnostics(
    generationModel: string,
    judgeModel: string,
    sharedDeploymentAllowed: boolean
): WeeklyReviewJudgeDeployment {
    return JudgeDeploymentSchema.parse({
        generationModel,
        judgeModel,
        independent: generationModel !== judgeModel,
        sharedDeploymentAllowed,
    });
}

export function readJudgeDeploymentDiagnostics(value: unknown): WeeklyReviewJudgeDeployment | null {
    const parsed = JudgeDeploymentSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
