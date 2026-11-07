/**
 * The sentences and labels the workspace, settings and company-profile
 * services write for a screen: the English reads exactly as it always did,
 * and the reader's language comes from the message key carried beside it.
 */

const mockRows: { rows: unknown[] } = { rows: [] };

// The history loaders read with one chained query each; every link returns the
// chain, and the last one (`limit`) answers with the rows a test sets.
jest.mock("~/server/db", () => {
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "from", "where", "orderBy", "innerJoin", "leftJoin"]) {
        chain[name] = () => chain;
    }
    chain.limit = () => Promise.resolve(mockRows.rows);
    return { db: chain };
});

import { copy } from "~/i18n/copy";
import { englishCopy, translatorFor, wordCopy } from "~/i18n/translate";
import {
    factLabelText,
    failureText,
    sourceReasonText,
    type ProfileServerT,
} from "~/components/company-profile/words";
import { factLabelKey, sourceReasonCopy } from "~/server/company-profile/adapter";
import { PIPELINE_LOADERS } from "~/server/history/loaders";
import { normalizeProfilePhoto, ProfilePhotoError } from "~/server/profile/photo";
import { ledgerDescription, ledgerDescriptionCopy } from "~/server/settings/usage";
import { wordModels } from "~/server/workspace-models/words";
import { badRequest, conflict } from "~/server/workspace/errors";

const zh = "zh-CN" as const;

describe("workspace errors", () => {
    it("keep their English message and word the copy for a Chinese reader", () => {
        const error = conflict(copy("team.server.errors.joinLinkExhausted"));
        expect(error.message).toBe("This join link has reached its use limit.");
        expect(wordCopy(error.copy!, zh)).toBe("这个加入链接已达到使用次数上限。");
    });

    it("name a built-in role in the reader's words, a custom one as it is called", () => {
        const builtin = copy("team.server.errors.cannotAssignBuiltinRole", { role: "admin" });
        expect(englishCopy(builtin)).toBe("You cannot assign the Admin role.");
        expect(wordCopy(builtin, zh)).toBe("你不能分配管理员角色。");
        const custom = copy("team.server.errors.cannotAssignRole", { role: "Reviewer" });
        expect(englishCopy(custom)).toBe("You cannot assign the Reviewer role.");
        expect(wordCopy(custom, zh)).toBe("你不能分配“Reviewer”角色。");
    });

    it("count members the way the English always did", () => {
        const one = badRequest(copy("team.server.errors.roleStillHeld", { count: 1 }));
        expect(one.message).toBe("1 member still hold this role. Choose a role to move them to.");
        const three = copy("team.server.errors.roleStillHeld", { count: 3 });
        expect(englishCopy(three)).toBe(
            "3 members still hold this role. Choose a role to move them to."
        );
        expect(wordCopy(three, zh)).toBe("仍有 3 名成员持有这个角色。请选择要把他们移到哪个角色。");
    });

    it("say which kind of principal an id is wrong for", () => {
        const bad = copy("team.server.errors.invalidPrincipalId", { type: "group", id: "abc" });
        expect(englishCopy(bad)).toBe('Invalid group id "abc".');
        expect(wordCopy(bad, zh)).toBe("无效的群组 ID“abc”。");
    });

    it("word a settings scope refusal", () => {
        const bad = copy("settings.server.errors.scopeNotAllowed", {
            key: "appearance.theme",
            scope: "folder",
        });
        expect(englishCopy(bad)).toBe('"appearance.theme" cannot be set at the folder scope');
        expect(wordCopy(bad, zh)).toBe("“appearance.theme”不能在文件夹范围设置");
    });
});

describe("the credits ledger", () => {
    const ledger = (locale: "en" | "zh-CN", description: string) => {
        const shown = ledgerDescriptionCopy(ledgerDescription(description));
        if (!shown) return null;
        return translatorFor(locale, "settings.server.ledger")(shown.key, shown.values as never);
    };

    it("reads the descriptions the app writes back into message data", () => {
        expect(ledgerDescriptionCopy("signup_bonus: +10,000,000 tokens")).toEqual({
            key: "grant",
            values: { grantType: "signup_bonus", amount: "10,000,000" },
        });
        expect(ledgerDescriptionCopy("Proposals: review")).toEqual({ key: "proposalsReview" });
        expect(ledgerDescriptionCopy("Something a script wrote by hand")).toBeNull();
    });

    it("words them as the stored English for English readers", () => {
        for (const description of [
            "signup_bonus: +10,000,000 tokens",
            "Chat query (fast route)",
            "Embed 1234 chunks for document 56",
            "OCR 12 pages",
            'Scenario "Launch week" (round 2)',
            'Scenario "Launch week" (brief)',
            "rerank usage",
        ]) {
            expect(ledger("en", description)).toBe(description);
        }
        // The provider is dropped on read, as before.
        expect(ledger("en", "Transcribe call.m4a via gemini")).toBe("Transcribe call.m4a");
    });

    it("words them in Chinese, numbers printed as stored", () => {
        expect(ledger(zh, "signup_bonus: +10,000,000 tokens")).toBe("注册赠送：+10,000,000 token");
        expect(ledger(zh, "Embed 1234 chunks for document 56")).toBe("为文档 56 嵌入 1234 个分块");
        expect(ledger(zh, 'Scenario "Launch week" (brief)')).toBe("情景“Launch week”（简报）");
    });
});

describe("the company profile", () => {
    const tEn = translatorFor("en", "companyProfile.server") as unknown as ProfileServerT;
    const tZh = translatorFor(zh, "companyProfile.server") as unknown as ProfileServerT;

    it("keys a fact label only while it is the default for its path", () => {
        expect(factLabelKey("company.founded_year", "Founded")).toBe("company.foundedYear");
        expect(factLabelKey("profile.facts.idea", "The idea")).toBe("profile.idea");
        expect(factLabelKey("profile.facts.mission", "Our purpose")).toBeNull();
        expect(factLabelKey("profile.facts.custom_thing", "Custom thing")).toBeNull();

        const fact = {
            label: "Annual budget",
            labelKey: factLabelKey("profile.facts.annual_budget", "Annual budget"),
        };
        expect(factLabelText(tEn, fact)).toBe("Annual budget");
        expect(factLabelText(tZh, fact)).toBe("年度预算");
        expect(factLabelText(tZh, { label: "Our purpose", labelKey: null })).toBe("Our purpose");
    });

    it("words the reasons the rules give, and leaves the model's own words alone", () => {
        const noise =
            "Only reference lists and number tables — nothing about the organisation to read.";
        const source = { reason: noise, reasonCopy: sourceReasonCopy(noise) };
        expect(source.reasonCopy).toEqual({ key: "onlyNoise", drops: ["references", "table"] });
        expect(sourceReasonText(tEn, source)).toBe(noise);
        expect(sourceReasonText(tZh, source)).toBe(
            "只有参考文献列表和数字表格，没有关于该组织的可读内容。"
        );

        const rule = "No readable text in this file.";
        expect(sourceReasonText(tZh, { reason: rule, reasonCopy: sourceReasonCopy(rule) })).toBe(
            "这个文件中没有可读的文本。"
        );

        const model = "Acme's own pitch deck.";
        expect(sourceReasonCopy(model)).toBeNull();
        expect(sourceReasonText(tZh, { reason: model, reasonCopy: null })).toBe(model);
    });

    it("words the fixed failure sentences", () => {
        expect(failureText(tZh, { error: "The last build failed", errorKey: "buildFailed" })).toBe(
            "上次生成失败"
        );
        expect(failureText(tZh, { error: "socket hang up", errorKey: null })).toBe(
            "socket hang up"
        );
    });
});

describe("a refused profile photo", () => {
    it("says why in English, and carries the words for a Chinese reader", async () => {
        const refusal = await normalizeProfilePhoto(Buffer.alloc(0)).catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(ProfilePhotoError);
        const error = refusal as ProfilePhotoError;
        expect(error.message).toBe("That file is empty.");
        expect(wordCopy(error.copy, zh)).toBe("这个文件是空的。");
    });
});

describe("the workspace-model sentences", () => {
    it("are worded back from their English, values and all", () => {
        expect(wordModels("The address has to start with https://.", zh)).toBe(
            "地址必须以 https:// 开头。"
        );
        expect(
            wordModels(
                "The endpoint doesn't list its models (HTTP 404). Type the model id yourself.",
                zh
            )
        ).toBe("该端点不提供模型列表（HTTP 404）。请自己输入模型 ID。");
        expect(
            wordModels(
                '"acme chat" doesn\'t look like a model id. Copy it exactly as your provider lists it.',
                zh
            )
        ).toBe("“acme chat”看起来不像模型 ID。请按服务商列出的原样复制。");
        expect(wordModels("Upstream said no", zh)).toBe("Upstream said no");
        expect(wordModels("The address has to start with https://.", "en")).toBe(
            "The address has to start with https://."
        );
    });
});

describe("history rows a loader names itself", () => {
    const loader = (kind: string) => PIPELINE_LOADERS.find(l => l.kind === kind)!;
    const ctx = { companyId: BigInt(5), userId: "user-a", limit: 10 };
    const at = new Date("2026-10-20T10:00:00Z");

    it("keep their English by default and follow the reader's language", async () => {
        mockRows.rows = [
            {
                id: "w1",
                status: "published",
                periodStart: "2026-10-12",
                periodEnd: "2026-10-18",
                createdAt: at,
                generatedAt: at,
                publishedAt: at,
                updatedAt: at,
            },
        ];
        const [english] = await loader("weekly-review").load(ctx);
        expect(english!.title).toBe("Week of 2026-10-12");
        const [chinese] = await loader("weekly-review").load({ ...ctx, locale: zh });
        expect(chinese!.title).toBe("2026-10-12 当周");
    });

    it("fall back to the kind's name in the reader's language", async () => {
        mockRows.rows = [
            {
                id: "p1",
                kind: "draft",
                status: "completed",
                applicationId: null,
                applicationTitle: null,
                summary: null,
                createdAt: at,
                updatedAt: at,
                completedAt: at,
            },
        ];
        const [english] = await loader("proposals").load(ctx);
        expect([english!.title, english!.subtitle]).toEqual(["Drafts", "Proposals"]);
        const [chinese] = await loader("proposals").load({ ...ctx, locale: zh });
        expect([chinese!.title, chinese!.subtitle]).toEqual(["草稿", "提案"]);

        mockRows.rows = [
            {
                id: "t1",
                status: "completed",
                query: null,
                createdAt: at,
                updatedAt: at,
                completedAt: at,
            },
        ];
        const [trend] = await loader("trend-search").load({ ...ctx, locale: zh });
        expect([trend!.title, trend!.subtitle]).toEqual(["趋势搜索", "趋势搜索"]);
    });
});
