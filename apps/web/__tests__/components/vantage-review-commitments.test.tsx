import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

test("review-to-commitment bridge artifacts are absent while legacy commitment entry points remain", () => {
    expect(
        existsSync(
            resolve(
                process.cwd(),
                "src/app/employer/tools/vantage/_components/ReviewCommitmentDialog.tsx"
            )
        )
    ).toBe(false);
    for (const locale of ["en", "zh-CN"]) {
        const messages = JSON.parse(read(`src/i18n/messages/${locale}/vantage.json`));
        for (const key of [
            "addCommitment",
            "added",
            "commitmentTitle",
            "commitmentOwner",
            "commitmentDue",
            "commitmentTest",
            "commitmentDescription",
            "confirmCommitment",
            "cancel",
            "commitmentLink",
        ]) {
            expect(messages.weeklyReview.founder).not.toHaveProperty(key);
        }
    }
    expect(read("src/app/employer/tools/vantage/api.ts")).toContain("addCommitment");
    expect(read("src/app/api/vantage/commitments/route.ts")).toContain(
        "export async function POST"
    );
    expect(read("src/app/employer/tools/vantage/_screens/CommitmentsScreen.tsx")).toContain(
        "vantageApi.addCommitment"
    );
});

test("deployment configuration does not advertise unsupported secret-box rotation controls", () => {
    for (const path of ["../../.env.example", "src/env.ts"]) {
        const source = read(path);
        expect(source).not.toMatch(/SECRET_BOX_(?:CURRENT_VERSION|PREVIOUS_KEYS)/);
        expect(source).toContain("EMBEDDING_SECRETS_KEY");
    }
});
