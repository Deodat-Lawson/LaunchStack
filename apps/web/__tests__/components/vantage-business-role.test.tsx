/** @jest-environment jsdom */
import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { WeeklyReviewBusinessRole } from "~/app/employer/tools/vantage/_screens/WeeklyReviewBusinessRole";
import { WeeklyReviewEntry } from "~/app/employer/tools/vantage/_screens/WeeklyReviewEntry";
import type { BusinessRoleContext } from "~/server/vantage/weekly-review-business-role";

jest.mock("~/app/employer/tools/vantage/_screens/AgendaScreen", () => ({
    AgendaScreen: () => <p>Legacy agenda</p>,
}));
jest.mock("~/app/employer/tools/vantage/_screens/WeeklyReviewEvidence", () => ({
    SourceScopeEditor: () => <p>Source scopes</p>,
    EvidenceInspector: () => null,
    EvidenceRefs: () => null,
}));
jest.mock("~/components/ui/select", () => ({
    Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const role: BusinessRoleContext = {
    schemaVersion: "vantage-business-role/v1",
    primaryRole: "Finance lead",
    responsibilities: ["Forecast cash flow"],
    priorities: ["Extend runway"],
    confirmedBy: "person",
    companyId: "1",
    revision: 3,
    confirmed: true,
};
const confirmName = "I confirm these are my current business responsibilities and priorities.";
function expandRole() {
    fireEvent.click(screen.getByText("My business responsibilities"));
}

describe("confirmed business role form", () => {
    it("requires confirmation and sends normalized explicit fields", () => {
        const save = jest.fn(async () => {});
        renderWithLocale(
            <WeeklyReviewBusinessRole role={null} disabled={false} onSave={save} />,
            "en"
        );
        expandRole();
        fireEvent.change(screen.getByLabelText("Primary business role"), {
            target: { value: " Finance lead " },
        });
        fireEvent.change(screen.getByLabelText("Responsibilities"), {
            target: { value: " Cash flow \n\n Forecasting " },
        });
        fireEvent.change(screen.getByLabelText("Priorities"), {
            target: { value: " Extend runway " },
        });
        const button = screen.getByRole("button", { name: "Confirm and save" });
        expect(button).toBeDisabled();
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        fireEvent.click(button);
        expect(save).toHaveBeenCalledWith({
            primaryRole: "Finance lead",
            responsibilities: ["Cash flow", "Forecasting"],
            priorities: ["Extend runway"],
            confirmed: true,
        });
    });

    it("resets confirmation when responsibilities change", () => {
        renderWithLocale(
            <WeeklyReviewBusinessRole role={role} disabled={false} onSave={jest.fn()} />,
            "en"
        );
        expandRole();
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeEnabled();
        fireEvent.change(screen.getByLabelText("Responsibilities"), {
            target: { value: "New responsibility" },
        });
        expect(screen.getByRole("checkbox", { name: confirmName })).not.toBeChecked();
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
    });

    it.each([
        ["too many responsibilities", "Responsibilities", Array<string>(9).fill("work").join("\n")],
        ["an overlong priority", "Priorities", "x".repeat(161)],
    ])("prevents saving %s", (_name, label, value) => {
        renderWithLocale(
            <WeeklyReviewBusinessRole role={role} disabled={false} onSave={jest.fn()} />,
            "en"
        );
        expandRole();
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
    });

    it("clears saved context through the explicit clear action", () => {
        const save = jest.fn(async () => {});
        renderWithLocale(
            <WeeklyReviewBusinessRole role={role} disabled={false} onSave={save} />,
            "en"
        );
        expandRole();
        fireEvent.click(screen.getByRole("button", { name: "Clear business role" }));
        expect(save).toHaveBeenCalledWith(null);
    });

    it("disables every editor and mutation for a read-only actor", () => {
        renderWithLocale(
            <WeeklyReviewBusinessRole role={role} disabled={true} onSave={jest.fn()} />,
            "en"
        );
        expandRole();
        expect(screen.getByLabelText("Primary business role")).toBeDisabled();
        expect(screen.getByLabelText("Responsibilities")).toBeDisabled();
        expect(screen.getByLabelText("Priorities")).toBeDisabled();
        expect(screen.getByRole("checkbox", { name: confirmName })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Confirm and save" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Clear business role" })).toBeDisabled();
    });
});

describe("role and source preference refresh", () => {
    const respond = (value: unknown) => ({ ok: true, json: async () => value });
    const fetchMock = jest.fn();
    beforeEach(() => {
        fetchMock.mockReset();
        global.fetch = fetchMock;
    });

    it("reloads the role version after saving stars and refreshes stars after confirming a role", async () => {
        let version = 3;
        const writes: { path: string; body: Record<string, unknown> }[] = [];
        fetchMock.mockImplementation(async (path: string, options: RequestInit) => {
            if (options.method === "PATCH") {
                expect(typeof options.body).toBe("string");
                const body = JSON.parse(options.body as string) as Record<string, unknown>;
                writes.push({ path, body });
                expect(body.expectedVersion).toBe(version);
                version++;
                return respond({ version });
            }
            if (path.endsWith("/context/role"))
                return respond({ role, version, canEdit: true, enabled: true });
            if (path.endsWith("/context"))
                return respond({
                    documents: [],
                    canConfigure: false,
                    preferences: { version, star_document_ids: [], star_source_scopes: {} },
                });
            return respond({ enabled: true, activeId: null, runs: [] });
        });
        renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
        await screen.findByText("My business responsibilities");
        fireEvent.click(screen.getByText("Personal starred documents"));
        fireEvent.click(screen.getByRole("button", { name: "Save personal stars" }));
        await waitFor(() => expect(writes).toHaveLength(1));
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Save personal stars", hidden: true })
            ).toBeEnabled()
        );
        expandRole();
        fireEvent.click(screen.getByRole("checkbox", { name: confirmName }));
        fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
        await waitFor(() => expect(writes).toHaveLength(2));
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Save personal stars", hidden: true })
            ).toBeEnabled()
        );
        expect(writes[0]).toMatchObject({
            path: "/api/vantage/reviews/context",
            body: { expectedVersion: 3 },
        });
        expect(writes[1]).toMatchObject({
            path: "/api/vantage/reviews/context/role",
            body: { expectedVersion: 4, confirmed: true },
        });
        fireEvent.click(screen.getByText("Personal starred documents"));
        fireEvent.click(screen.getByRole("button", { name: "Save personal stars" }));
        await waitFor(() => expect(writes).toHaveLength(3));
        expect(writes[2]?.body.expectedVersion).toBe(5);
    });

    it("honors fresh read-only capability from the role endpoint", async () => {
        fetchMock.mockImplementation(async (path: string) => {
            if (path.endsWith("/context/role"))
                return respond({ role, version: 3, canEdit: false, enabled: true });
            if (path.endsWith("/context")) return respond({ documents: [], canConfigure: false });
            return respond({ enabled: true, activeId: null, runs: [] });
        });
        renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
        await screen.findByText("My business responsibilities");
        expandRole();
        expect(screen.getByLabelText("Primary business role")).toBeDisabled();
        expect(screen.getByRole("button", { name: "Clear business role" })).toBeDisabled();
    });

    it("keeps the role form hidden when the internal-retrieval opt-in is disabled", async () => {
        fetchMock.mockImplementation(async (path: string) => {
            if (path.endsWith("/context/role"))
                return respond({ role, version: 3, canEdit: true, enabled: false });
            if (path.endsWith("/context")) return respond({ documents: [], canConfigure: false });
            return respond({ enabled: true, activeId: null, runs: [] });
        });
        renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
        await waitFor(() =>
            expect(
                screen.getByRole("button", { name: "Save personal stars", hidden: true })
            ).toBeEnabled()
        );
        expect(screen.queryByText("My business responsibilities")).not.toBeInTheDocument();
    });
});

describe("weekly review and Context separation", () => {
    const fetchMock = jest.fn();
    const saved = {
        id: "accepted",
        version: 1,
        decisions: [],
        evidence: {},
        report: {
            headline: "Generated weekly findings",
            brief: "Brief",
            summary: "Summary",
            keyFigures: [],
            topics: [
                {
                    id: "topic",
                    title: "Decide next action",
                    facts: [],
                    conflicts: [],
                    whyItMatters: "Why",
                    whyNow: "Now",
                    decisionQuestion: "Decision?",
                    rationale: "Because",
                    proposedNextStep: "Follow up",
                    unknowns: [],
                },
            ],
        },
    };
    beforeEach(() => {
        global.fetch = fetchMock;
        fetchMock.mockReset().mockImplementation(async (path: string) => ({
            ok: true,
            json: async () =>
                path.includes("?weekStart=")
                    ? {
                          enabled: true,
                          activeId: "accepted",
                          runs: [
                              {
                                  id: "accepted",
                                  status: "accepted",
                                  week_start: "2026-11-09",
                                  created_at: "2026-11-10",
                              },
                          ],
                      }
                    : path.endsWith("/context/role")
                      ? { role, version: 3, canEdit: true, enabled: true }
                      : path.endsWith("/context")
                        ? {
                              canConfigure: true,
                              documents: [{ id: "101", title: "Company plan" }],
                              policy: {
                                  version: 1,
                                  architecture_document_id: "101",
                                  required_document_ids: [],
                              },
                              preferences: { version: 3, star_document_ids: ["101"] },
                          }
                        : saved,
        }));
    });

    it("shows the generated review and decision editor without any generation setup in This Week", async () => {
        renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
        await screen.findByText("Generated weekly findings");
        expect(screen.getByRole("button", { name: "Generate review" })).toBeEnabled();
        expect(screen.getByLabelText("Human decision")).toBeInTheDocument();
        expect(screen.getByText("Report history")).toBeInTheDocument();
        for (const label of [
            "My business responsibilities",
            "Required company context",
            "Personal starred documents",
            "Source scopes",
        ])
            expect(screen.queryByText(label)).not.toBeInTheDocument();
    });

    it("shows all setup in Context without fetching or rendering generated reports and decisions", async () => {
        renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
        await screen.findByText("My business responsibilities");
        expect(screen.getByText("Required company context")).toBeInTheDocument();
        expect(screen.getByText("Personal starred documents")).toBeInTheDocument();
        expect(screen.getByText("Source scopes")).toBeInTheDocument();
        expect(screen.queryByText("Generated weekly findings")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Human decision")).not.toBeInTheDocument();
        expect(screen.queryByLabelText("Reporting week")).not.toBeInTheDocument();
        expect(screen.queryByText("Report history")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Generate review" })).not.toBeInTheDocument();
        expect(fetchMock).not.toHaveBeenCalledWith(
            "/api/vantage/reviews/accepted",
            expect.anything()
        );
        expect(screen.getByRole("link", { name: "Open This Week" })).toHaveAttribute(
            "href",
            "/employer/documents?feature=vantage&at=%2F%3Fweek%3D2026-11-09"
        );
    });

    it("links an unconfigured empty This Week to Context", async () => {
        fetchMock.mockImplementation(async (path: string) => ({
            ok: true,
            json: async () =>
                path.endsWith("/context/role")
                    ? { role: null, version: 0, canEdit: true, enabled: true }
                    : path.endsWith("/context")
                      ? { canConfigure: true, policy: null, documents: [] }
                      : { enabled: true, activeId: null, runs: [] },
        }));
        renderWithLocale(<WeeklyReviewEntry week="2026-11-09" />, "en");
        expect(await screen.findByRole("link", { name: "Open Context" })).toHaveAttribute(
            "href",
            "/employer/documents?feature=vantage&at=%2Fcontext%3Fweek%3D2026-11-09"
        );
    });

    it("does not open the legacy agenda or a broken editor from disabled Context", async () => {
        fetchMock.mockImplementation(async () => ({
            ok: true,
            json: async () => ({ enabled: false, activeId: null, runs: [] }),
        }));
        renderWithLocale(<WeeklyReviewEntry view="context" week="2026-11-09" />, "en");
        await screen.findByText(
            "Context setup is unavailable while Weekly Review is disabled. Continue with the existing weekly agenda."
        );
        expect(screen.queryByText("Legacy agenda")).not.toBeInTheDocument();
        expect(screen.queryByText("My business responsibilities")).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
