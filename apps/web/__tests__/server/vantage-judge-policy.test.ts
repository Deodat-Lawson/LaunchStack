import {
    allowSharedJudgeDeployment,
    judgeDeploymentDiagnostics,
    readJudgeDeploymentDiagnostics,
} from "~/server/vantage/weekly-review-judge-policy";

it.each([undefined, "false", "TRUE", "1"])("keeps the default for %s", value => {
    expect(allowSharedJudgeDeployment({ VANTAGE_ALLOW_SHARED_JUDGE_DEPLOYMENT: value })).toBe(
        false
    );
});

it("requires the explicit true switch and reports actual deployment independence", () => {
    expect(allowSharedJudgeDeployment({ VANTAGE_ALLOW_SHARED_JUDGE_DEPLOYMENT: "true" })).toBe(
        true
    );
    expect(judgeDeploymentDiagnostics("luna", "luna", true)).toEqual({
        generationModel: "luna",
        judgeModel: "luna",
        independent: false,
        sharedDeploymentAllowed: true,
    });
    expect(judgeDeploymentDiagnostics("luna", "judge", true).independent).toBe(true);
});

it("does not invent independence for legacy or malformed diagnostics", () => {
    expect(readJudgeDeploymentDiagnostics(undefined)).toBeNull();
    expect(readJudgeDeploymentDiagnostics({ independent: false, prompt: "private" })).toBeNull();
});
