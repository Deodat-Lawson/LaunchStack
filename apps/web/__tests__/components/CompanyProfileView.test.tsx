/** @jest-environment jsdom */

/**
 * The company profile — the one page Settings › Company and Proposals ›
 * Profile both render. What it pins is honesty: every fact shows the
 * excerpts that prove it, an unknown applicant type shows nothing rather
 * than "Not stated", a workspace whose sources are someone else's reads as
 * "nothing proven yet" with the reasons in view, the evidence list is
 * exactly what the server sent, and a viewer without settings.manage is
 * offered no control they cannot use.
 */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import type {
    CompanyProfileDto,
    ProfileSourceDto,
    ProfileFactPatch,
    ProfileSourcePatch,
} from "~/lib/company-profile/dto";

const mockApi = {
    get: jest.fn<Promise<{ profile: CompanyProfileDto }>, []>(),
    rebuild: jest.fn<Promise<{ profile: CompanyProfileDto }>, []>(),
    patchFact: jest.fn<Promise<{ profile: CompanyProfileDto }>, [ProfileFactPatch]>(),
    setSource: jest.fn<Promise<{ profile: CompanyProfileDto }>, [number, ProfileSourcePatch]>(),
};
jest.mock("~/lib/company-profile/api", () => ({
    companyProfileApi: {
        get: () => mockApi.get(),
        rebuild: () => mockApi.rebuild(),
        patchFact: (patch: ProfileFactPatch) => mockApi.patchFact(patch),
        setSource: (id: number, patch: ProfileSourcePatch) => mockApi.setSource(id, patch),
    },
}));

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { CompanyProfileView } from "~/components/company-profile/CompanyProfileView";
import { factPathFor } from "~/components/company-profile/words";

function source(over: Partial<ProfileSourceDto> & { documentId: number }): ProfileSourceDto {
    return {
        title: `Source ${over.documentId}`,
        folder: "",
        role: "about_us",
        roleBy: "model",
        reason: null,
        override: null,
        counted: true,
        facts: 0,
        status: "done",
        error: null,
        href: `/employer/documents?source=d${over.documentId}`,
        ...over,
    };
}

const PAPER_REASON =
    "A research paper by authors at the University of Washington, Tencent AI Lab, UPenn and CMU — not about LaunchStack.";

function readyProfile(over: Partial<CompanyProfileDto> = {}): CompanyProfileDto {
    const sources = [
        source({
            documentId: 41,
            title: "Pitch deck.pdf",
            reason: "LaunchStack's own deck.",
            facts: 2,
        }),
        source({ documentId: 43, title: "Incorporation.pdf", facts: 1 }),
        source({
            documentId: 45,
            title: "Investor update.pdf",
            role: "third_party",
            override: "about_us",
            counted: true,
            reason: "Reads like an investor newsletter.",
        }),
        source({
            documentId: 46,
            title: "2312.06648v3.pdf",
            role: "third_party",
            counted: false,
            reason: PAPER_REASON,
        }),
    ];
    return {
        status: "ready",
        error: null,
        builtAt: new Date().toISOString(),
        stale: false,
        name: "LaunchStack",
        summary: "LaunchStack is a document workspace for small teams.",
        summaryCites: [1],
        applicantType: "for_profit",
        focusAreas: ["Document AI"],
        geography: ["United States"],
        markets: ["Nonprofits"],
        facts: [
            {
                path: "company.headquarters",
                label: "Headquarters",
                value: "Baltimore, Maryland",
                cites: [2],
                source: "documents",
            },
            {
                path: "profile.facts.mission",
                label: "Mission",
                value: "Give small teams a research staff",
                cites: [1, 2],
                source: "documents",
            },
            {
                path: "profile.facts.annual_budget",
                label: "Annual budget",
                value: "$480k",
                cites: [],
                source: "manual",
            },
        ],
        people: [
            {
                path: "people.0",
                name: "Maya Chen",
                detail: "Founder",
                detailPath: "people.0.role",
                cites: [2],
                source: "documents",
            },
        ],
        services: [],
        projects: [],
        legal: [],
        evidence: [
            {
                n: 1,
                documentId: 41,
                title: "Pitch deck.pdf",
                page: 2,
                quote: "We give small teams a research staff.",
                href: "/employer/documents?source=d41",
            },
            {
                n: 2,
                documentId: 43,
                title: "Incorporation.pdf",
                page: null,
                quote: "Principal office Baltimore, Maryland.",
                href: null,
            },
        ],
        sources,
        counts: { sources: 4, counted: 3, setAside: 1, pending: 0 },
        canEdit: true,
        ...over,
    };
}

function nothingProfile(): CompanyProfileDto {
    const sources = [
        source({
            documentId: 12,
            title: "2312.06648v3.pdf",
            role: "third_party",
            counted: false,
            reason: PAPER_REASON.replace("LaunchStack.", "LaunchStack Dev."),
        }),
        source({
            documentId: 13,
            title: "Untitled mindmap",
            role: "no_content",
            roleBy: "rules",
            counted: false,
            reason: "An empty test mindmap.",
        }),
    ];
    return readyProfile({
        name: "LaunchStack Dev",
        summary: null,
        summaryCites: [],
        applicantType: null,
        focusAreas: [],
        geography: [],
        markets: [],
        facts: [],
        people: [],
        evidence: [],
        sources,
        counts: { sources: 2, counted: 0, setAside: 2, pending: 0 },
    });
}

async function renderWith(
    profile: CompanyProfileDto,
    variant: "settings" | "proposals" = "proposals"
) {
    mockApi.get.mockResolvedValue({ profile });
    render(<CompanyProfileView variant={variant} />);
    await waitFor(() => expect(mockApi.get).toHaveBeenCalled());
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("CompanyProfileView", () => {
    it("shows each fact with the numbers of the excerpts that prove it", async () => {
        await renderWith(readyProfile());

        const hq = await screen.findByText("Baltimore, Maryland");
        expect(within(hq).getByLabelText("Source 2: Incorporation.pdf")).toHaveTextContent("2");

        const mission = screen.getByText("Give small teams a research staff");
        expect(within(mission).getByLabelText("Source 1: Pitch deck.pdf")).toBeInTheDocument();
        expect(within(mission).getByLabelText("Source 2: Incorporation.pdf")).toBeInTheDocument();

        // A hand-set fact carries no number and says it was edited.
        const budget = screen.getByText("$480k");
        expect(within(budget).queryByLabelText(/^Source /)).toBeNull();
        expect(screen.getByText("· edited")).toBeInTheDocument();

        // The header counts facts and the sources read for them.
        expect(screen.getByText(/3 facts from 3 sources · built/)).toBeInTheDocument();
    });

    it("never shows a 'Not stated' chip when the applicant type is unknown", async () => {
        await renderWith(readyProfile({ applicantType: null }));

        const chips = await screen.findByRole("list", { name: "At a glance" });
        expect(within(chips).queryByText("Not stated")).toBeNull();
        expect(within(chips).queryByText("Company")).toBeNull();
        expect(within(chips).getByText("Document AI")).toBeInTheDocument();
        expect(within(chips).getByText("United States")).toBeInTheDocument();
        expect(within(chips).getByText("Nonprofits")).toBeInTheDocument();
        expect(screen.queryByText("Not stated")).toBeNull();
    });

    it("shows the applicant type when there is one", async () => {
        await renderWith(readyProfile());
        const chips = await screen.findByRole("list", { name: "At a glance" });
        expect(within(chips).getByText("Company")).toBeInTheDocument();
    });

    it("lists set-aside sources with their reason, and Count this source overrules the reader", async () => {
        const user = userEvent.setup();
        const before = readyProfile();
        const after = readyProfile({
            stale: true,
            sources: before.sources.map(s =>
                s.documentId === 46 ? { ...s, override: "about_us", counted: true } : s
            ),
        });
        mockApi.setSource.mockResolvedValue({ profile: after });
        await renderWith(before);

        const aside = await screen.findByRole("group", { name: "Set aside" });
        expect(within(aside).getByText("2312.06648v3.pdf")).toBeInTheDocument();
        expect(within(aside).getByText(PAPER_REASON)).toBeInTheDocument();
        expect(within(aside).getByText(/Someone else's/)).toBeInTheDocument();

        await user.click(within(aside).getByRole("button", { name: /Count this source/ }));
        expect(mockApi.setSource).toHaveBeenCalledWith(46, { override: "about_us" });

        // The returned profile is the one drawn: the paper now counts, as the person's call.
        const counted = await screen.findByRole("group", { name: "Read for the profile" });
        await waitFor(() =>
            expect(within(counted).getByText("2312.06648v3.pdf")).toBeInTheDocument()
        );
        expect(screen.queryByRole("group", { name: "Set aside" })).toBeNull();
        expect(screen.getByRole("status")).toHaveTextContent(/Out of date/);
    });

    it("marks a person's call and offers to undo it", async () => {
        const user = userEvent.setup();
        mockApi.setSource.mockResolvedValue({ profile: readyProfile() });
        await renderWith(readyProfile());

        const counted = await screen.findByRole("group", { name: "Read for the profile" });
        const row = within(counted).getByText("Investor update.pdf").closest("li")!;
        expect(within(row).getByText("· your call")).toBeInTheDocument();
        // Overruling the reader: the only control is Undo.
        expect(within(row).queryByRole("button", { name: /Set aside/ })).toBeNull();

        await user.click(within(row).getByRole("button", { name: /Undo/ }));
        expect(mockApi.setSource).toHaveBeenCalledWith(45, { override: null });
    });

    it("offers no edit or override controls to someone who cannot edit", async () => {
        await renderWith(readyProfile({ canEdit: false }));

        await screen.findByText("Baltimore, Maryland");
        expect(screen.queryAllByRole("button", { name: /^Edit / })).toHaveLength(0);
        expect(screen.queryByRole("button", { name: /Count this source/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Set aside/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Undo/ })).toBeNull();
        expect(screen.queryByRole("button", { name: /Add a fact/ })).toBeNull();
        expect(
            screen.getByText(/An admin can edit its facts and decide which sources count/)
        ).toBeInTheDocument();
        // Anyone may rebuild.
        expect(screen.getByRole("button", { name: "Rebuild profile" })).toBeEnabled();
    });

    it("says plainly when no source is about the company, with the set-aside list right there", async () => {
        await renderWith(nothingProfile());

        expect(
            await screen.findByRole("heading", {
                name: "None of your sources is about LaunchStack Dev yet",
            })
        ).toBeInTheDocument();
        expect(
            screen.getByText(/All 2 of your sources were read and set aside/)
        ).toBeInTheDocument();
        expect(screen.queryByRole("alert")).toBeNull();

        const aside = screen.getByRole("group", { name: "Set aside" });
        expect(within(aside).getByText(/not about LaunchStack Dev\./)).toBeInTheDocument();
        expect(within(aside).getByText("An empty test mindmap.")).toBeInTheDocument();
        expect(within(aside).getByText(/Nothing to read/)).toBeInTheDocument();
        // No empty sections pretending to be content.
        expect(screen.queryByRole("region", { name: "Evidence" })).toBeNull();
        expect(screen.queryByRole("region", { name: "People" })).toBeNull();
    });

    it("when sources count but prove nothing, says so instead of 'none is about you'", async () => {
        const p = nothingProfile();
        await renderWith({
            ...p,
            sources: [
                ...p.sources,
                source({
                    documentId: 90,
                    title: "Pitch deck.pdf",
                    status: "failed",
                    error: "The model provider did not answer",
                }),
            ],
        });
        expect(
            await screen.findByRole("heading", {
                name: "Nothing about LaunchStack Dev could be proven yet",
            })
        ).toBeInTheDocument();
        // A failed source shows why it failed, not why it was sorted where it was.
        expect(
            screen.getByText(
                "Could not be read: The model provider did not answer. Rebuild to try again."
            )
        ).toBeInTheDocument();
    });

    it("says an unread source will be read on the next build, without a spinner, when nothing is building", async () => {
        const p = nothingProfile();
        await renderWith({
            ...p,
            sources: [
                ...p.sources,
                source({
                    documentId: 91,
                    title: "New notes.md",
                    role: null,
                    roleBy: null,
                    counted: false,
                    status: "pending",
                }),
            ],
        });
        expect(await screen.findByText("Read on the next build.")).toBeInTheDocument();
        expect(screen.queryByText("Reading…")).toBeNull();
    });

    it("lists exactly the evidence the profile sends, numbered, linking only what can be opened", async () => {
        await renderWith(readyProfile());

        const evidence = await screen.findByRole("region", { name: "Evidence" });
        const quotes = within(evidence).getAllByText(/^“.*”$/);
        expect(quotes.map(q => q.textContent)).toEqual([
            "“We give small teams a research staff.”",
            "“Principal office Baltimore, Maryland.”",
        ]);
        expect(within(evidence).getByRole("link", { name: "Pitch deck.pdf" })).toHaveAttribute(
            "href",
            "/employer/documents?source=d41"
        );
        expect(within(evidence).getByText(/· p\. 2/)).toBeInTheDocument();
        // href null: a title, not a link.
        expect(within(evidence).queryByRole("link", { name: "Incorporation.pdf" })).toBeNull();
        expect(within(evidence).getByText("Incorporation.pdf")).toBeInTheDocument();
    });

    it("saves an edited fact by its path and draws the profile that comes back", async () => {
        const user = userEvent.setup();
        const base = readyProfile();
        mockApi.patchFact.mockResolvedValue({
            profile: readyProfile({
                facts: base.facts.map(f =>
                    f.path === "company.headquarters"
                        ? { ...f, value: "Baltimore, MD", cites: [], source: "manual" as const }
                        : f
                ),
            }),
        });
        await renderWith(base);

        await user.click(await screen.findByRole("button", { name: "Edit Headquarters" }));
        const box = screen.getByRole("textbox", { name: "Edit Headquarters" });
        await user.clear(box);
        await user.type(box, "Baltimore, MD");
        await user.click(screen.getByRole("button", { name: "Save" }));

        expect(mockApi.patchFact).toHaveBeenCalledWith({
            path: "company.headquarters",
            value: "Baltimore, MD",
        });
        expect(await screen.findByText("Baltimore, MD")).toBeInTheDocument();
    });

    it("offers to go back to what the sources say on an edited fact", async () => {
        const base = readyProfile();
        const edited = { ...base.facts[0]!, source: "manual" as const };
        mockApi.patchFact.mockResolvedValue({ profile: base });
        await renderWith({ ...base, facts: [edited, ...base.facts.slice(1)] });
        await userEvent.click(await screen.findByRole("button", { name: `Edit ${edited.label}` }));
        await userEvent.click(screen.getByRole("button", { name: "Use what the sources say" }));
        expect(mockApi.patchFact).toHaveBeenCalledWith({
            path: edited.path,
            value: "",
            reset: true,
        });
    });

    it("lists agreements, and lets an editor take a person off the profile", async () => {
        const base = readyProfile();
        mockApi.patchFact.mockResolvedValue({ profile: base });
        await renderWith({
            ...base,
            legal: [
                {
                    path: "legal.0",
                    name: "MSA with Globex",
                    detail: "Master services agreement, renews yearly",
                    detailPath: "legal.0.summary",
                    cites: [],
                    source: "documents",
                },
            ],
        });
        const agreements = await screen.findByRole("region", { name: "Agreements" });
        expect(within(agreements).getByText("MSA with Globex")).toBeInTheDocument();

        const person = base.people[0]!;
        await userEvent.click(screen.getByRole("button", { name: `Edit ${person.name}` }));
        await userEvent.click(screen.getByRole("button", { name: `Remove ${person.name}` }));
        expect(mockApi.patchFact).toHaveBeenCalledWith({ path: `${person.path}.name`, value: "" });
    });

    it("edits a person's detail by its detail path", async () => {
        const user = userEvent.setup();
        mockApi.patchFact.mockResolvedValue({ profile: readyProfile() });
        await renderWith(readyProfile());

        await user.click(await screen.findByRole("button", { name: "Edit Maya Chen" }));
        const box = screen.getByRole("textbox", { name: "Edit Maya Chen" });
        await user.clear(box);
        await user.type(box, "CEO");
        await user.click(screen.getByRole("button", { name: "Save" }));
        expect(mockApi.patchFact).toHaveBeenCalledWith({ path: "people.0.role", value: "CEO" });
    });

    it("adds a fact the documents do not say under profile.facts.<slug>", async () => {
        const user = userEvent.setup();
        mockApi.patchFact.mockResolvedValue({ profile: readyProfile() });
        await renderWith(readyProfile());

        await user.click(await screen.findByRole("button", { name: /Add a fact/ }));
        await user.type(screen.getByLabelText("Label"), "Board size");
        await user.type(screen.getByLabelText("Value"), "Three directors");
        await user.click(screen.getByRole("button", { name: "Add fact" }));

        expect(mockApi.patchFact).toHaveBeenCalledWith({
            path: "profile.facts.board_size",
            label: "Board size",
            value: "Three directors",
        });
    });

    it("keeps asking while the profile is building and stops once it is ready", async () => {
        jest.useFakeTimers();
        try {
            const building = readyProfile({ status: "building" });
            mockApi.get
                .mockResolvedValueOnce({ profile: building })
                .mockResolvedValueOnce({ profile: building })
                .mockResolvedValue({ profile: readyProfile() });
            render(<CompanyProfileView variant="proposals" />);
            expect(await screen.findByText("Reading your sources now")).toBeInTheDocument();

            await act(async () => {
                jest.advanceTimersByTime(2600);
            });
            await act(async () => {
                jest.advanceTimersByTime(2600);
            });
            await waitFor(() =>
                expect(screen.getByText(/3 facts from 3 sources/)).toBeInTheDocument()
            );
            const calls = mockApi.get.mock.calls.length;
            expect(calls).toBe(3);

            await act(async () => {
                jest.advanceTimersByTime(10_000);
            });
            expect(mockApi.get.mock.calls.length).toBe(calls);
        } finally {
            jest.useRealTimers();
        }
    });

    it("says there is nothing to read when the workspace has no sources", async () => {
        await renderWith(
            readyProfile({
                status: "empty",
                builtAt: null,
                facts: [],
                people: [],
                evidence: [],
                summary: null,
                sources: [],
                counts: { sources: 0, counted: 0, setAside: 0, pending: 0 },
            })
        );
        expect(await screen.findByText("Nothing to read yet")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Build profile" })).toBeDisabled();
    });

    it("shows a failed build as an error with a retry", async () => {
        mockApi.rebuild.mockResolvedValue({ profile: readyProfile({ status: "building" }) });
        await renderWith(
            readyProfile({
                status: "failed",
                error: "The model provider did not answer.",
                facts: [],
                people: [],
                summary: null,
                evidence: [],
            })
        );
        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("The model provider did not answer.");
        fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
        await waitFor(() => expect(mockApi.rebuild).toHaveBeenCalled());
    });

    it("in Settings, publishes Rebuild into the hub's action area for an editor", async () => {
        const onActions = jest.fn();
        mockApi.get.mockResolvedValue({ profile: readyProfile() });
        render(<CompanyProfileView variant="settings" onActions={onActions} />);
        await screen.findByText("Baltimore, Maryland");

        await waitFor(() =>
            expect(onActions).toHaveBeenLastCalledWith(
                expect.objectContaining({ primaryLabel: "Rebuild profile", disabled: false })
            )
        );
        // The hub owns the title; the body draws no display header of its own.
        expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
        expect(screen.queryByRole("button", { name: "Rebuild profile" })).toBeNull();
    });
});

describe("factPathFor", () => {
    it("slugs the label into a-z0-9_ and keeps it to 64 characters", () => {
        expect(factPathFor("Annual budget")).toBe("profile.facts.annual_budget");
        expect(factPathFor("  Café — opening hours! ")).toBe("profile.facts.cafe_opening_hours");
        expect(factPathFor("x".repeat(80))).toBe(`profile.facts.${"x".repeat(64)}`);
        expect(factPathFor("!!!")).toBe("profile.facts.fact");
    });

    it("never reuses a path a fact already has", () => {
        expect(factPathFor("Mission", ["profile.facts.mission"])).toBe("profile.facts.mission_2");
        expect(factPathFor("Mission", ["profile.facts.mission", "profile.facts.mission_2"])).toBe(
            "profile.facts.mission_3"
        );
    });
});
