import { randomUUID } from "node:crypto";
import postgres from "postgres";

function checkedUrl() {
    const value = process.env.VANTAGE_SCOPED_TEST_DATABASE_URL;
    if (!value) throw new Error("VANTAGE_SCOPED_TEST_DATABASE_URL is required");
    const url = new URL(value);
    if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        url.port !== "55570" ||
        url.pathname !== "/vantage_scoped_evidence_20261113"
    ) {
        throw new Error("Refusing non-owned synthetic database");
    }
    return value;
}

// Official migrated tables, independent synthetic tenants, no shared schema reset.
describe("identity authority epochs through PostgreSQL", () => {
    let sql: ReturnType<typeof postgres>;
    let companyIds: string[];
    let userIds: string[];
    let membershipId: string;
    const epoch = async (companyId: string) => {
        const [row] =
            await sql`SELECT version::text FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=${companyId}`;
        return row?.version ?? "0";
    };
    const epochs = () => Promise.all(companyIds.map(epoch));

    beforeEach(async () => {
        sql = postgres(checkedUrl(), { max: 3, idle_timeout: 1 });
        companyIds = [];
        userIds = [];
        for (let index = 0; index < 3; index++) {
            const [company] =
                await sql`INSERT INTO pdr_ai_v2_company(name,"numberOfEmployees") VALUES ('authority epoch synthetic','1') RETURNING id::text`;
            companyIds.push(company!.id);
        }
        for (let index = 0; index < 2; index++) {
            const subject = randomUUID();
            const [user] =
                await sql`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id) VALUES ('Synthetic',${subject + "@example.invalid"},${subject},${companyIds[0]!}) RETURNING id::text`;
            userIds.push(user!.id);
        }
        const [membership] =
            await sql`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role) VALUES (${userIds[0]!},${companyIds[0]!},'owner') RETURNING id::text`;
        membershipId = membership!.id;
        await sql`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role) VALUES (${userIds[0]!},${companyIds[1]!},'member')`;
    });
    afterEach(async () => {
        try {
            for (const companyId of companyIds ?? []) {
                await sql`DELETE FROM pdr_ai_v2_company WHERE id=${companyId}`;
                await sql`DELETE FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=${companyId}`;
            }
        } finally {
            await sql?.end({ timeout: 2 });
        }
    });

    it("ignores every incidental column and relevant-value no-op, including activity plus updated_at", async () => {
        const before = await epochs();
        await sql`UPDATE pdr_ai_v2_users SET name='Updated profile',last_active_at=now(),created_at=now(),updated_at=now(),display_name='Display',title='Title',pronouns='they',time_zone='UTC',bio='Synthetic bio',provider_photo_checked_at=now() WHERE id=${userIds[0]!}`;
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET last_opened_at=now(),created_at=now(),updated_at=now(),profile_display_name='Workspace profile',profile_title='Workspace title' WHERE id=${membershipId}`;
        await sql`UPDATE pdr_ai_v2_users SET id=id,"userId"="userId",company_id=company_id,email=email,role=role,status=status WHERE id=${userIds[0]!}`;
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET id=id,user_id=user_id,company_id=company_id,role=role,status=status WHERE id=${membershipId}`;
        expect(await epochs()).toEqual(before);
        // Null transitions use value comparisons, with no incidental epoch bump.
        await sql`UPDATE pdr_ai_v2_users SET last_active_at=NULL,display_name=NULL,updated_at=NULL WHERE id=${userIds[0]!}`;
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET profile_title=NULL,updated_at=NULL WHERE id=${membershipId}`;
        expect(await epochs()).toEqual(before);
    });

    it("invalidates identity, permission, and old/new tenant membership changes", async () => {
        for (const assignment of [
            `"userId"='${randomUUID()}'`,
            "email='changed@example.invalid'",
            "role='admin'",
            "status='suspended'",
        ]) {
            const before = await epochs();
            await sql.unsafe(`UPDATE pdr_ai_v2_users SET ${assignment} WHERE id=$1`, [userIds[0]!]);
            const after = await epochs();
            expect(BigInt(after[0])).toBeGreaterThan(BigInt(before[0]));
            expect(BigInt(after[1])).toBeGreaterThan(BigInt(before[1]));
            expect(after[2]).toBe(before[2]);
        }
        for (const assignment of [
            "role='guest'",
            "status='suspended'",
            "id=id+1000000000",
            `user_id=${userIds[1]!}`,
        ]) {
            const before = await epochs();
            const [membership] = await sql.unsafe(
                `UPDATE pdr_ai_v2_user_company_memberships SET ${assignment} WHERE id=$1 RETURNING id::text`,
                [membershipId]
            );
            membershipId = membership!.id;
            const after = await epochs();
            expect(BigInt(after[0])).toBeGreaterThan(BigInt(before[0]));
            expect(after.slice(1)).toEqual(before.slice(1));
        }
        let before = await epochs();
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET company_id=${companyIds[2]!} WHERE id=${membershipId}`;
        let after = await epochs();
        expect(BigInt(after[0])).toBeGreaterThan(BigInt(before[0]));
        expect(BigInt(after[2])).toBeGreaterThan(BigInt(before[2]));
        expect(after[1]).toBe(before[1]);
        before = after;
        await sql`UPDATE pdr_ai_v2_users SET company_id=${companyIds[2]!} WHERE id=${userIds[0]!}`;
        after = await epochs();
        for (const index of [0, 1, 2])
            expect(BigInt(after[index])).toBeGreaterThan(BigInt(before[index]));
        // A user PK can change only without referencing memberships under the real FK.
        const [unreferenced] =
            await sql`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id) VALUES ('Synthetic','pk@example.invalid',${randomUUID()},${companyIds[0]!}) RETURNING id::text`;
        before = await epochs();
        await sql`UPDATE pdr_ai_v2_users SET id=id+1000000000 WHERE id=${unreferenced!.id}`;
        after = await epochs();
        expect(BigInt(after[0])).toBeGreaterThan(BigInt(before[0]));
        expect(after.slice(1)).toEqual(before.slice(1));
    });

    it("retains INSERT/DELETE invalidation and AFTER conflict no-op semantics", async () => {
        let before = await epochs();
        await sql`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role) VALUES (${userIds[0]!},${companyIds[0]!},'owner') ON CONFLICT DO NOTHING`;
        expect(await epochs()).toEqual(before);
        await sql`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id) SELECT name,email,"userId",company_id FROM pdr_ai_v2_users WHERE id=${userIds[0]!} ON CONFLICT DO NOTHING`;
        expect(await epochs()).toEqual(before);
        const [membership] =
            await sql`INSERT INTO pdr_ai_v2_user_company_memberships(user_id,company_id,role) VALUES (${userIds[1]!},${companyIds[2]!},'member') RETURNING id::text`;
        expect(BigInt(await epoch(companyIds[2]!))).toBeGreaterThan(BigInt(before[2]));
        before = await epochs();
        await sql`DELETE FROM pdr_ai_v2_user_company_memberships WHERE id=${membership!.id}`;
        expect(BigInt(await epoch(companyIds[2]!))).toBeGreaterThan(BigInt(before[2]));
        before = await epochs();
        const [user] =
            await sql`INSERT INTO pdr_ai_v2_users(name,email,"userId",company_id) VALUES ('Synthetic','delete@example.invalid',${randomUUID()},${companyIds[2]!}) RETURNING id::text`;
        expect(BigInt(await epoch(companyIds[2]!))).toBeGreaterThan(BigInt(before[2]));
        before = await epochs();
        await sql`DELETE FROM pdr_ai_v2_users WHERE id=${user!.id}`;
        expect(BigInt(await epoch(companyIds[2]!))).toBeGreaterThan(BigInt(before[2]));
        const triggers =
            await sql`SELECT tgtype::int FROM pg_trigger WHERE tgrelid='pdr_ai_v2_users'::regclass AND tgname LIKE 'vantage_authority_%'`;
        expect(triggers).toHaveLength(2);
        for (const trigger of triggers) expect(trigger.tgtype & 2).toBe(0);
    });

    it("rolls back epoch changes atomically and retains document/version/chunk invalidation", async () => {
        const beforeRollback = await epochs();
        const rollback = new Error("synthetic rollback");
        await expect(
            sql.begin(async tx => {
                await tx`UPDATE pdr_ai_v2_user_company_memberships SET status='suspended' WHERE id=${membershipId}`;
                throw rollback;
            })
        ).rejects.toBe(rollback);
        expect(await epochs()).toEqual(beforeRollback);
        let before = await epoch(companyIds[0]!);
        const [document] =
            await sql`INSERT INTO pdr_ai_v2_document(url,category,title,company_id) VALUES ('synthetic','Shared','Residual invalidation',${companyIds[0]!}) RETURNING id::text`;
        expect(BigInt(await epoch(companyIds[0]!))).toBeGreaterThan(BigInt(before));
        before = await epoch(companyIds[0]!);
        await sql`UPDATE pdr_ai_v2_document SET updated_at=now() WHERE id=${document!.id}`;
        expect(BigInt(await epoch(companyIds[0]!))).toBeGreaterThan(BigInt(before));
        before = await epoch(companyIds[0]!);
        const [version] =
            await sql`INSERT INTO pdr_ai_v2_document_versions(document_id,version_number,url,mime_type) VALUES (${document!.id},1,'synthetic','text/plain') RETURNING id::text`;
        expect(BigInt(await epoch(companyIds[0]!))).toBeGreaterThan(BigInt(before));
        before = await epoch(companyIds[0]!);
        await sql`INSERT INTO pdr_ai_v2_document_context_chunks(document_id,version_id,content,page_number,line_start) VALUES (${document!.id},${version!.id},'Synthetic context',1,1)`;
        expect(BigInt(await epoch(companyIds[0]!))).toBeGreaterThan(BigInt(before));
    });

    it("keeps revocations serialized with same-tenant admission and permits incidental/other-tenant writes", async () => {
        let entered!: () => void;
        let release!: () => void;
        const locked = new Promise<void>(resolve => {
            entered = resolve;
        });
        const continued = new Promise<void>(resolve => {
            release = resolve;
        });
        const writer = postgres(checkedUrl(), { max: 1, idle_timeout: 1 });
        const transaction = sql.begin(async tx => {
            await tx`SELECT version FROM pdr_ai_v2_vantage_weekly_review_epochs WHERE company_id=${companyIds[0]!} FOR SHARE`;
            entered();
            await continued;
        });
        try {
            await locked;
            await writer`SET lock_timeout='200ms'`;
            await writer`UPDATE pdr_ai_v2_users SET last_active_at=now(),updated_at=now() WHERE id=${userIds[0]!}`;
            await writer`UPDATE pdr_ai_v2_user_company_memberships SET last_opened_at=now(),updated_at=now() WHERE id=${membershipId}`;
            await writer`UPDATE pdr_ai_v2_user_company_memberships SET role='viewer' WHERE user_id=${userIds[0]!} AND company_id=${companyIds[1]!}`;
            await expect(
                writer`UPDATE pdr_ai_v2_user_company_memberships SET status='suspended' WHERE id=${membershipId}`
            ).rejects.toMatchObject({ code: "55P03" });
            await expect(
                writer`UPDATE pdr_ai_v2_users SET "userId"=${randomUUID()} WHERE id=${userIds[0]!}`
            ).rejects.toMatchObject({ code: "55P03" });
        } finally {
            release();
            await transaction;
            await writer.end({ timeout: 2 });
        }
        const before = await epochs();
        await sql`UPDATE pdr_ai_v2_user_company_memberships SET status='suspended' WHERE id=${membershipId}`;
        expect(BigInt(await epoch(companyIds[0]!))).toBeGreaterThan(BigInt(before[0]));
    });
});
