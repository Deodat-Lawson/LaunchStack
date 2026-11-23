/** @jest-environment jsdom */
import type React from "react";
import * as mockReact from "react";
import { createHash, webcrypto } from "node:crypto";
import { TextEncoder } from "node:util";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { renderWithLocale } from "~/i18n/testing/render";
import { ContextScreen } from "~/app/employer/tools/vantage/_screens/ContextScreen";
import {
    weeklyReviewApi,
    type WeeklyReviewContextDto,
    type WeeklyReviewRoleDto,
} from "~/app/employer/tools/vantage/api";

jest.mock("sonner", () => ({ toast: { success: jest.fn() } }));

jest.mock("~/components/ui/select", () => {
    const SelectItem = ({ value, children }: { value: string; children: React.ReactNode }) => (
        <option value={value}>{children}</option>
    );
    return {
        Select: ({
            children,
            value,
            onValueChange,
            disabled,
        }: {
            children: React.ReactNode;
            value?: string;
            onValueChange: (value: string) => void;
            disabled?: boolean;
        }) => {
            const elements = mockReact.Children.toArray(children) as React.ReactElement<{
                id?: string;
                children?: React.ReactNode;
            }>[];
            return (
                <select
                    id={elements[0]?.props.id}
                    value={value ?? ""}
                    disabled={disabled}
                    onChange={event => onValueChange(event.target.value)}
                >
                    <option value="" />
                    {elements[1]?.props.children}
                </select>
            );
        },
        SelectTrigger: () => null,
        SelectValue: () => null,
        SelectContent: () => null,
        SelectItem,
    };
});

const pin = {
    version: "22",
    expectedParentHash: "a".repeat(64),
    qualification: "Reviewed",
    requiredUnits: [{ id: "one", start: 0, end: 5, excerptHash: "b".repeat(64) }],
};
let context: WeeklyReviewContextDto;
let roleContext: WeeklyReviewRoleDto;
let version: number;
beforeEach(() => {
    jest.restoreAllMocks();
    version = 3;
    context = {
        enabled: true,
        scopedEvidenceEnabled: true,
        canConfigure: true,
        documents: [
            { id: "101", title: "Architecture", category: "plan" },
            { id: "202", title: "Customer findings", category: "research" },
            { id: "303", title: "Finance", category: "finance" },
            { id: "404", title: "Roadmap", category: "plan" },
        ],
        policy: {
            architecture_document_id: "101",
            required_document_ids: ["202"],
            required_source_scopes: { "101": pin, "202": pin },
            version: 2,
            hasHiddenSources: false,
        },
        preferences: {
            star_document_ids: ["303"],
            star_source_scopes: { "303": pin },
            version,
            hasHiddenSources: false,
        },
    };
    roleContext = {
        enabled: true,
        canEdit: true,
        version,
        role: {
            schemaVersion: "vantage-business-role/v1",
            primaryRole: "Finance lead",
            responsibilities: ["Cash flow"],
            priorities: [],
            confirmedBy: "person",
            companyId: "1",
            revision: 3,
            confirmed: true,
        },
    };
    jest.spyOn(weeklyReviewApi, "context").mockImplementation(async () => ({
        ...context,
        preferences: context.preferences ? { ...context.preferences, version } : null,
    }));
    jest.spyOn(weeklyReviewApi, "role").mockImplementation(async () => ({
        ...roleContext,
        version,
    }));
    jest.spyOn(weeklyReviewApi, "list").mockRejectedValue(Error("Context must not load reports"));
    jest.spyOn(weeklyReviewApi, "get").mockRejectedValue(Error("Context must not load reports"));
    jest.spyOn(weeklyReviewApi, "savePolicy").mockImplementation(async input => {
        context = {
            ...context,
            policy: {
                ...context.policy!,
                architecture_document_id: input.architectureDocumentId,
                required_document_ids: input.requiredDocumentIds,
                required_source_scopes: input.requiredSourceScopes ?? {},
                version: input.expectedVersion + 1,
            },
        };
        return { version: input.expectedVersion + 1 };
    });
    jest.spyOn(weeklyReviewApi, "saveStars").mockImplementation(async input => {
        expect(input.expectedVersion).toBe(version);
        version++;
        context = {
            ...context,
            preferences: {
                ...context.preferences!,
                star_document_ids: input.starDocumentIds,
                star_source_scopes: input.starSourceScopes ?? {},
                version,
            },
        };
        return { version };
    });
    jest.spyOn(weeklyReviewApi, "saveRole").mockImplementation(async input => {
        expect(input.expectedVersion).toBe(version);
        version++;
        return { role: roleContext.role, version };
    });
});
function openSection(title: string) {
    const trigger = screen.getByRole("button", { name: title });
    if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
}
function card(title: string) {
    if (title !== "Setup checklist") openSection(title);
    return screen.getByRole("heading", { name: title }).closest<HTMLElement>('[data-slot="card"]')!;
}
async function renderContext(openRole = true) {
    renderWithLocale(<ContextScreen week="2026-11-12" />, "en");
    await screen.findByRole("heading", { name: "Setup checklist" });
    if (openRole && roleContext.enabled) openSection("Your role");
}

it("loads setup without report calls, collapses completed sections and anchors the week", async () => {
    await renderContext(false);
    for (const section of ["Your role", "Company documents", "Your starred documents"])
        expect(screen.getByRole("button", { name: section })).toHaveAttribute(
            "aria-expanded",
            "false"
        );
    expect(screen.getByText("Finance lead")).toBeInTheDocument();
    expect(screen.getByText("Architecture + 1 required")).toBeInTheDocument();
    expect(screen.getByText("1 of 8 starred")).toBeInTheDocument();
    expect(weeklyReviewApi.list).not.toHaveBeenCalled();
    expect(weeklyReviewApi.get).not.toHaveBeenCalled();
    expect(within(card("Setup checklist")).getAllByText("Done")).toHaveLength(3);
    expect(screen.getByRole("link", { name: "Go to This week" })).toHaveAttribute(
        "href",
        "/employer/documents?feature=vantage&at=%2F%3Fweek%3D2026-11-09"
    );
    expect(screen.queryByRole("button", { name: "Generate review" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Human decision")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Source to inspect")).not.toBeInTheDocument();
    card("Company documents");
    expect(
        screen.getByRole("button", { name: "Save required context", hidden: true })
    ).toBeDisabled();
    card("Your starred documents");
    expect(screen.getByRole("button", { name: "Save personal stars" })).toBeDisabled();
});

it.each(["role", "company", "stars"] as const)(
    "opens the first incomplete %s section on load",
    async missing => {
        if (missing === "role") roleContext = { ...roleContext, role: null };
        if (missing === "company") context = { ...context, policy: null };
        if (missing === "stars")
            context = {
                ...context,
                preferences: { ...context.preferences!, star_document_ids: [] },
            };
        await renderContext(false);
        for (const [id, label] of [
            ["role", "Your role"],
            ["company", "Company documents"],
            ["stars", "Your starred documents"],
        ])
            expect(screen.getByRole("button", { name: label })).toHaveAttribute(
                "aria-expanded",
                String(id === missing)
            );
    }
);

it("stepper opens and scrolls the selected section without losing a collapsed role draft", async () => {
    const frame = jest
        .spyOn(window, "requestAnimationFrame")
        .mockImplementation((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
    await renderContext();
    fireEvent.change(screen.getByLabelText("Responsibilities"), {
        target: { value: "Unsaved founder responsibility" },
    });
    const company = document.getElementById("context-company")!;
    const scroll = jest.fn();
    company.scrollIntoView = scroll;
    fireEvent.click(screen.getByRole("button", { name: "Open Company documents" }));
    expect(screen.getByRole("button", { name: "Company documents" })).toHaveAttribute(
        "aria-expanded",
        "true"
    );
    expect(screen.getByRole("button", { name: "Your role" })).toHaveAttribute(
        "aria-expanded",
        "false"
    );
    expect(scroll).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Your role" }));
    expect(screen.getByLabelText("Responsibilities")).toHaveValue("Unsaved founder responsibility");
    expect(weeklyReviewApi.saveRole).not.toHaveBeenCalled();
    expect(weeklyReviewApi.savePolicy).not.toHaveBeenCalled();
    expect(weeklyReviewApi.saveStars).not.toHaveBeenCalled();
    frame.mockRestore();
});

it("tracks unsaved edits without marking setup complete and filters document choices", async () => {
    context = {
        ...context,
        policy: null,
        preferences: { ...context.preferences!, star_document_ids: [] },
    };
    roleContext = { ...roleContext, role: null };
    await renderContext();
    expect(within(card("Setup checklist")).getAllByText("Not set")).toHaveLength(3);
    fireEvent.change(screen.getByLabelText("Primary business role"), {
        target: { value: "Founder" },
    });
    fireEvent.change(within(card("Your starred documents")).getByLabelText("Search documents"), {
        target: { value: "Finance" },
    });
    expect(
        within(card("Your starred documents")).queryByLabelText("Roadmap")
    ).not.toBeInTheDocument();
    fireEvent.click(within(card("Your starred documents")).getByLabelText("Finance"));
    expect(screen.getByText("1 of 8 Starred")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save personal stars" })).toBeEnabled();
    expect(within(card("Setup checklist")).getAllByText("Not set")).toHaveLength(3);
    expect(screen.queryByRole("link", { name: "Go to This week" })).not.toBeInTheDocument();
});

it("preserves unrelated scope maps when saving company and personal documents", async () => {
    await renderContext();
    fireEvent.click(within(card("Company documents")).getByLabelText("Roadmap"));
    fireEvent.click(screen.getByRole("button", { name: "Save required context" }));
    await waitFor(() =>
        expect(weeklyReviewApi.savePolicy).toHaveBeenCalledWith({
            expectedVersion: 2,
            architectureDocumentId: "101",
            requiredDocumentIds: ["202", "404"],
            requiredSourceScopes: { "101": pin, "202": pin },
        })
    );
    await waitFor(() =>
        expect(
            screen.getByRole("button", { name: "Save required context", hidden: true })
        ).toBeDisabled()
    );
    fireEvent.click(within(card("Your starred documents")).getByLabelText("Roadmap"));
    fireEvent.click(screen.getByRole("button", { name: "Save personal stars" }));
    await waitFor(() =>
        expect(weeklyReviewApi.saveStars).toHaveBeenCalledWith({
            expectedVersion: 3,
            starDocumentIds: ["303", "404"],
            starSourceScopes: { "303": pin },
        })
    );
});

it("refreshes shared preference versions after saving stars and role", async () => {
    await renderContext();
    fireEvent.click(within(card("Your starred documents")).getByLabelText("Roadmap"));
    fireEvent.click(screen.getByRole("button", { name: "Save personal stars" }));
    await waitFor(() => expect(weeklyReviewApi.role).toHaveBeenCalledTimes(2));
    card("Your role");
    fireEvent.change(screen.getByLabelText("Responsibilities"), {
        target: { value: "Forecasting" },
    });
    fireEvent.click(
        screen.getByRole("checkbox", {
            name: "I confirm these are my current business responsibilities and priorities.",
        })
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm and save" }));
    await waitFor(() =>
        expect(weeklyReviewApi.saveRole).toHaveBeenCalledWith(
            expect.objectContaining({
                expectedVersion: 4,
                responsibilities: ["Forecasting"],
                confirmed: true,
            })
        )
    );
    await waitFor(() => expect(weeklyReviewApi.context).toHaveBeenCalledTimes(3));
    fireEvent.click(within(card("Your starred documents")).getByLabelText("Customer findings"));
    fireEvent.click(screen.getByRole("button", { name: "Save personal stars" }));
    await waitFor(() =>
        expect(weeklyReviewApi.saveStars).toHaveBeenLastCalledWith(
            expect.objectContaining({ expectedVersion: 5 })
        )
    );
});

it("honors hidden configuration and current editing capabilities", async () => {
    context = {
        ...context,
        canConfigure: false,
        preferences: { ...context.preferences!, hasHiddenSources: true },
        policy: { ...context.policy!, hasHiddenSources: true },
    };
    roleContext = { ...roleContext, canEdit: false };
    await renderContext();
    expect(screen.getByLabelText("Primary business role")).toBeDisabled();
    expect(within(card("Company documents")).getByLabelText("Roadmap")).toBeDisabled();
    expect(within(card("Your starred documents")).getByLabelText("Roadmap")).toBeDisabled();
    expect(
        within(card("Your role")).getByRole("button", { name: "Clear business role" })
    ).toBeDisabled();
    expect(
        within(card("Your starred documents")).getByRole("button", { name: "Save personal stars" })
    ).toBeDisabled();
});

it("keeps failed saves actionable and displays a plain localized error", async () => {
    jest.spyOn(weeklyReviewApi, "saveStars").mockRejectedValue(Error("stale_context_preferences"));
    await renderContext();
    fireEvent.click(within(card("Your starred documents")).getByLabelText("Roadmap"));
    fireEvent.click(screen.getByRole("button", { name: "Save personal stars" }));
    expect(await screen.findByRole("alert")).not.toHaveTextContent("stale_context_preferences");
    expect(screen.getByRole("button", { name: "Save personal stars" })).toBeEnabled();
});

it("caps personal stars at eight while allowing deselection", async () => {
    context = {
        ...context,
        documents: Array.from({ length: 9 }, (_, index) => ({
            id: String(index + 1),
            title: `Document ${index + 1}`,
            category: "plan",
        })),
        preferences: {
            ...context.preferences!,
            star_document_ids: Array.from({ length: 8 }, (_, index) => String(index + 1)),
            star_source_scopes: {},
        },
    };
    await renderContext();
    const stars = within(card("Your starred documents"));
    expect(stars.getByLabelText("Document 9")).toBeDisabled();
    expect(stars.getByLabelText("Document 1")).toBeEnabled();
    fireEvent.click(stars.getByLabelText("Document 1"));
    expect(stars.getByLabelText("Document 9")).toBeEnabled();
});

function chooseScope(value = "company-architecture:101") {
    fireEvent.click(screen.getByRole("button", { name: /Advanced:/ }));
    fireEvent.change(screen.getByLabelText("Source to inspect"), { target: { value } });
}
function inspect(purpose: "company-architecture" | "personal-star" = "company-architecture") {
    return {
        document: { id: purpose === "personal-star" ? "303" : "101", title: "Source" },
        purpose,
        configurationVersion: purpose === "personal-star" ? version : 2,
        pin: { status: "missing_version" as const, scope: pin },
        versions: [{ version: "22", createdAt: "2026-11-01T00:00:00Z" }],
        preview: null,
    };
}
it("clears one company pin through policy CAS while preserving the other scope", async () => {
    jest.spyOn(weeklyReviewApi, "read").mockResolvedValue(inspect());
    await renderContext();
    chooseScope();
    fireEvent.click(await screen.findByRole("button", { name: "Clear pinned scope" }));
    await waitFor(() =>
        expect(weeklyReviewApi.savePolicy).toHaveBeenCalledWith({
            expectedVersion: 2,
            architectureDocumentId: "101",
            requiredDocumentIds: ["202"],
            requiredSourceScopes: { "202": pin },
        })
    );
});
it("clears a personal pin through preference CAS and preserves other stars and scopes", async () => {
    context = {
        ...context,
        preferences: {
            ...context.preferences!,
            star_document_ids: ["303", "404"],
            star_source_scopes: { "303": pin, "404": pin },
        },
    };
    jest.spyOn(weeklyReviewApi, "read").mockResolvedValue(inspect("personal-star"));
    await renderContext();
    chooseScope("personal-star:303");
    fireEvent.click(await screen.findByRole("button", { name: "Clear pinned scope" }));
    await waitFor(() =>
        expect(weeklyReviewApi.saveStars).toHaveBeenCalledWith({
            expectedVersion: 3,
            starDocumentIds: ["303", "404"],
            starSourceScopes: { "404": pin },
        })
    );
});
it("leaves a failed scope clear actionable with its localized admission message", async () => {
    jest.spyOn(weeklyReviewApi, "read").mockResolvedValue(inspect());
    jest.spyOn(weeklyReviewApi, "savePolicy").mockRejectedValue(
        Error("source_context_unavailable")
    );
    await renderContext();
    chooseScope();
    fireEvent.click(await screen.findByRole("button", { name: "Clear pinned scope" }));
    await waitFor(() =>
        expect(screen.getAllByRole("alert").some(alert => alert.textContent?.includes(
            "The text for this document is not available yet. Check its source preview and try again."
        ))).toBe(true)
    );
    expect(screen.getByRole("button", { name: "Clear pinned scope" })).toBeEnabled();
});

beforeAll(() => {
    Object.defineProperty(globalThis.crypto, "subtle", {
        configurable: true,
        value: webcrypto.subtle,
    });
    Object.defineProperty(globalThis, "TextEncoder", { configurable: true, value: TextEncoder });
});
it("reapproves one personal pin through normal PATCH without dropping another scope", async () => {
    const hash = (text: string) => createHash("sha256").update(text).digest("hex");
    const text = "alpha beta";
    context = {
        ...context,
        preferences: {
            ...context.preferences!,
            star_document_ids: ["303", "404"],
            star_source_scopes: { "303": pin, "404": pin },
        },
    };
    jest.spyOn(weeklyReviewApi, "read").mockImplementation(
        async path =>
            ({
                ...inspect("personal-star"),
                preview: path.includes("version=22")
                    ? {
                          version: "22",
                          parentHash: hash(text),
                          text,
                          chunks: [],
                          originalCompleteness: "unknown",
                          offsetEncoding: "utf16_half_open",
                      }
                    : null,
            }) as never
    );
    await renderContext();
    chooseScope("personal-star:303");
    await screen.findByLabelText("Source version");
    fireEvent.change(screen.getByLabelText("Source version"), { target: { value: "22" } });
    await screen.findByLabelText("Scope qualification");
    for (const [label, value] of [
        ["Scope qualification", "Pricing spans reviewed"],
        ["Unit ID 1", "pricing"],
        ["Start offset 1", "0"],
        ["End offset 1", "5"],
    ])
        fireEvent.change(screen.getByLabelText(label!), { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Approve finite scope" }));
    await waitFor(() =>
        expect(weeklyReviewApi.saveStars).toHaveBeenCalledWith({
            expectedVersion: 3,
            starDocumentIds: ["303", "404"],
            starSourceScopes: {
                "303": {
                    version: "22",
                    expectedParentHash: hash(text),
                    qualification: "Pricing spans reviewed",
                    requiredUnits: [
                        { id: "pricing", start: 0, end: 5, excerptHash: hash("alpha") },
                    ],
                },
                "404": pin,
            },
        })
    );
});
it("hides the role editor when retrieval is disabled without inferring a role", async () => {
    roleContext = { ...roleContext, enabled: false, role: null };
    renderWithLocale(<ContextScreen week="2026-11-09" />, "en");
    await screen.findByRole("heading", { name: "Setup checklist" });
    expect(screen.queryByLabelText("Primary business role")).not.toBeInTheDocument();
    expect(within(card("Setup checklist")).getByText("Not set")).toBeInTheDocument();
});
