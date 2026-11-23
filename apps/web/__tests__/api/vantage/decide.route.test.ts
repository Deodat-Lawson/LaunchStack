jest.mock("~/app/api/vantage/_http", () => ({
    vantageContext: jest.fn(),
    error: (message: string, status: number, fields: object) =>
        Response.json({ error: message, ...fields }, { status }),
    say: (_request: Request, key: string) => key,
}));
import { vantageContext } from "~/app/api/vantage/_http";
import { DELETE, POST } from "~/app/api/vantage/topics/[id]/decide/route";
import { PATCH, DELETE as deleteTopic } from "~/app/api/vantage/topics/[id]/route";
import { POST as addTopic } from "~/app/api/vantage/agendas/[id]/topics/route";
import { POST as reorder } from "~/app/api/vantage/agendas/[id]/reorder/route";
const context = { params: Promise.resolve({ id: "foreign-or-private" }) };
describe.each([DELETE, POST, PATCH, deleteTopic, addTopic, reorder])(
    "retired historical topic writer",
    handler => {
        it("returns 410 without inspecting or changing source-derived content", async () => {
            jest.mocked(vantageContext).mockResolvedValue({
                ok: true,
                ctx: { companyId: 1n, userId: "u", can: () => true },
            });
            const response = await handler(new Request("http://localhost/retired"), context);
            expect(response.status).toBe(410);
            expect(await response.json()).toMatchObject({
                code: "canonical_weekly_review_required",
            });
        });
        it("requires edit capability", async () => {
            jest.mocked(vantageContext).mockResolvedValue({
                ok: true,
                ctx: { companyId: 1n, userId: "u", can: () => false },
            });
            expect((await handler(new Request("http://localhost/retired"), context)).status).toBe(
                403
            );
        });
        it("preserves Beta and membership denial", async () => {
            jest.mocked(vantageContext).mockResolvedValue({
                ok: false,
                response: Response.json({}, { status: 404 }) as never,
            });
            expect((await handler(new Request("http://localhost/retired"), context)).status).toBe(
                404
            );
        });
    }
);
