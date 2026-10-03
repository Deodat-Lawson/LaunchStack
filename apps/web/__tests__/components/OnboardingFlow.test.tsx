/** @jest-environment jsdom */

/**
 * Workspace onboarding: website → what the company does and the idea →
 * documents → what we understood. What it pins: a saved second pass starts
 * filled in; an address that is not one is refused before anything is sent;
 * the answers are posted and the homepage imported into the Company folder;
 * documents go through the normal upload path into the same folder; the last
 * step shows the profile as it builds and links to Settings › Company; and
 * every step can be skipped.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import type { CompanyProfileDto, ProfileSourceDto } from "~/lib/company-profile/dto";

const mockReplace = jest.fn();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: mockReplace, push: jest.fn() }),
}));

const mockGetProfile = jest.fn<Promise<{ profile: CompanyProfileDto }>, []>();
jest.mock("~/lib/company-profile/api", () => ({
    companyProfileApi: { get: () => mockGetProfile() },
}));

const mockUpload = jest.fn();
const mockRegister = jest.fn();
jest.mock("~/app/employer/documents/_workspace/sourceUpload", () => ({
    uploadFileToStorage: (file: File) => mockUpload(file),
    registerDocument: (params: unknown) => mockRegister(params),
}));

import { OnboardingFlow } from "~/app/employer/onboarding/_components/OnboardingFlow";

interface Call {
    url: string;
    method: string;
    body: unknown;
}
let calls: Call[] = [];
let onboardingState: Record<string, unknown>;
let websiteResponse: { status: number; body: unknown };

// jsdom has no fetch Response; the flow only reads ok, status and json().
function json(status: number, body: unknown) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
    } as Response);
}

function source(over: Partial<ProfileSourceDto> & { documentId: number }): ProfileSourceDto {
    return {
        title: `Source ${over.documentId}`,
        folder: "Company",
        role: "about_us",
        roleBy: "model",
        reason: null,
        override: null,
        counted: true,
        facts: 0,
        status: "done",
        error: null,
        href: "",
        ...over,
    };
}

function profile(over: Partial<CompanyProfileDto> = {}): CompanyProfileDto {
    return {
        status: "ready",
        error: null,
        builtAt: null,
        stale: false,
        name: "Acme",
        summary: null,
        summaryCites: [],
        applicantType: null,
        focusAreas: [],
        geography: [],
        markets: [],
        facts: [],
        people: [],
        services: [],
        projects: [],
        legal: [],
        evidence: [],
        sources: [],
        counts: { sources: 0, counted: 0, setAside: 0, pending: 0 },
        canEdit: true,
        ...over,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    window.scrollTo = jest.fn();
    calls = [];
    onboardingState = {
        name: "Acme",
        website: null,
        description: null,
        idea: null,
        industry: null,
        saved: { website: false, description: false, idea: false },
        fromSources: { website: null, description: null },
        websiteImported: false,
        canEdit: true,
    };
    websiteResponse = { status: 202, body: { success: true } };
    mockGetProfile.mockResolvedValue({ profile: profile() });
    mockUpload.mockResolvedValue({ url: "/api/files/9", provider: "database" });
    mockRegister.mockResolvedValue(undefined);
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : null;
        calls.push({ url, method, body });
        if (url === "/api/company/onboarding" && method === "GET")
            return json(200, onboardingState);
        if (url === "/api/company/onboarding" && method === "POST")
            return json(200, { success: true, website: "https://acme.com/" });
        if (url === "/api/upload/website")
            return json(websiteResponse.status, websiteResponse.body);
        return json(404, { error: "not mocked" });
    }) as typeof fetch;
});

async function renderLoaded() {
    render(<OnboardingFlow />);
    await screen.findByRole("heading", { name: "Tell us about Acme" });
    await waitFor(() => expect(screen.getByLabelText("Website")).toBeEnabled());
}

it("starts a second pass filled in with what was saved", async () => {
    onboardingState = {
        name: "Acme",
        website: "https://acme.com/",
        description: "We make anvils.",
        idea: "Anvils by subscription.",
        industry: "Manufacturing",
        saved: { website: true, description: true, idea: true },
        websiteImported: true,
        canEdit: true,
    };
    await renderLoaded();
    expect(screen.getByLabelText("Website")).toHaveValue("https://acme.com/");
    expect(screen.getByLabelText("What does the company do?")).toHaveValue("We make anvils.");
    expect(screen.getByLabelText(/idea you.re working on/)).toHaveValue("Anvils by subscription.");
});

it("refuses an address that is not one, and sends nothing", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(screen.getByLabelText("Website"), "we make anvils");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("alert")).toHaveTextContent("doesn't look like a web address");
    expect(calls.filter(c => c.method === "POST")).toEqual([]);
    expect(screen.getByRole("heading", { name: "Tell us about Acme" })).toBeInTheDocument();
});

it("saves the answers and imports the homepage into the Company folder", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(screen.getByLabelText("Website"), "acme.com");
    await user.type(screen.getByLabelText("What does the company do?"), "We make anvils.");
    await user.type(screen.getByLabelText(/idea you.re working on/), "Anvils by subscription.");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const next = await screen.findByRole("heading", { name: "Add documents about the company" });
    // A new step starts at the top with its heading focused, not wherever the last one ended.
    expect(next).toHaveFocus();
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0 });
    const posts = calls.filter(c => c.method === "POST");
    expect(posts).toEqual([
        {
            url: "/api/company/onboarding",
            method: "POST",
            body: {
                website: "https://acme.com/",
                description: "We make anvils.",
                idea: "Anvils by subscription.",
            },
        },
        {
            url: "/api/upload/website",
            method: "POST",
            body: { url: "https://acme.com/", category: "Company" },
        },
    ]);
});

it("does not import the same homepage twice when someone goes back and continues again", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(screen.getByLabelText("Website"), "acme.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Add documents about the company" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Add documents about the company" });

    expect(calls.filter(c => c.url === "/api/upload/website")).toHaveLength(1);
});

it("uploads documents through the normal path into the Company folder", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await screen.findByRole("heading", { name: "Add documents about the company" });
    expect(calls.filter(c => c.method === "POST")).toEqual([]);

    const deck = new File(["%PDF"], "Pitch deck.pdf", { type: "application/pdf" });
    await user.upload(screen.getByLabelText("Choose documents about the company"), deck);

    const list = await screen.findByRole("list", { name: "Added documents" });
    await within(list).findByText("Added");
    expect(mockUpload).toHaveBeenCalledWith(deck);
    expect(mockRegister).toHaveBeenCalledWith({
        file: deck,
        url: "/api/files/9",
        provider: "database",
        category: "Company",
    });
});

it("shows a failed upload and lets the person move on", async () => {
    const user = userEvent.setup();
    mockUpload.mockRejectedValue(new Error("Too large"));
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await user.upload(
        screen.getByLabelText("Choose documents about the company"),
        new File(["x"], "big.pdf", { type: "application/pdf" })
    );
    expect(await screen.findByText("Failed: Too large")).toBeInTheDocument();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Continue/ })).toBeEnabled();
});

it("shows what was understood, the sources as they are read, and where to manage it", async () => {
    const user = userEvent.setup();
    mockGetProfile.mockResolvedValue({
        profile: profile({
            summary: "Acme makes anvils for small forges.",
            facts: [
                {
                    path: "company.website",
                    label: "Website",
                    value: "https://acme.com/",
                    cites: [],
                    source: "manual",
                },
            ],
            sources: [
                source({ documentId: 1, title: "acme.com", facts: 3 }),
                source({ documentId: 2, title: "Pitch deck.pdf", status: "pending", role: null }),
                source({
                    documentId: 3,
                    title: "Someone's paper.pdf",
                    role: "third_party",
                    counted: false,
                }),
            ],
        }),
    });
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await user.click(screen.getByRole("button", { name: /Skip this step/ }));

    await screen.findByText("Acme makes anvils for small forges.");
    const facts = screen.getByRole("definition");
    expect(facts).toHaveTextContent("https://acme.com/");
    expect(screen.getByText("· from you")).toBeInTheDocument();

    const sources = screen.getByRole("list", { name: "Sources being read" });
    expect(within(sources).getByText("About you · 3 facts")).toBeInTheDocument();
    expect(within(sources).getByText("Reading…")).toBeInTheDocument();
    expect(within(sources).getByText("Set aside")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "Review the company profile" })).toHaveAttribute(
        "href",
        "/employer/settings#company"
    );
    await user.click(screen.getByRole("button", { name: /Open your workspace/ }));
    expect(mockReplace).toHaveBeenCalledWith("/employer/documents");
});

it("keeps asking while sources are still being read", async () => {
    jest.useFakeTimers();
    try {
        const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
        mockGetProfile.mockResolvedValue({
            profile: profile({
                sources: [source({ documentId: 2, status: "pending", role: null })],
            }),
        });
        await renderLoaded();
        await user.click(screen.getByRole("button", { name: "Skip this step" }));
        await user.click(screen.getByRole("button", { name: /Skip this step/ }));
        await waitFor(() => expect(mockGetProfile).toHaveBeenCalledTimes(1));

        mockGetProfile.mockResolvedValue({
            profile: profile({ sources: [source({ documentId: 2, facts: 1 })] }),
        });
        await act(async () => {
            jest.advanceTimersByTime(3000);
        });
        await waitFor(() => expect(mockGetProfile).toHaveBeenCalledTimes(2));
        expect(await screen.findByText("About you · 1 fact")).toBeInTheDocument();

        await act(async () => {
            jest.advanceTimersByTime(10_000);
        });
        expect(mockGetProfile).toHaveBeenCalledTimes(2);
    } finally {
        jest.useRealTimers();
    }
});

it("offers to try a failed homepage import again", async () => {
    const user = userEvent.setup();
    websiteResponse = { status: 502, body: { error: "The site did not answer" } };
    await renderLoaded();
    await user.type(screen.getByLabelText("Website"), "acme.com");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: /Skip this step/ }));

    expect(await screen.findByText("The site did not answer")).toBeInTheDocument();
    websiteResponse = { status: 202, body: { success: true } };
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Homepage imported")).toBeInTheDocument();
    expect(calls.filter(c => c.url === "/api/upload/website")).toHaveLength(2);
});

it("Skip setup leaves for the workspace from any step", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip setup" }));
    expect(mockReplace).toHaveBeenCalledWith("/employer/documents");
    expect(calls.filter(c => c.method === "POST")).toEqual([]);
});

it("lists what the person told us before what the sources say, and links to the rest", async () => {
    const user = userEvent.setup();
    const sourced = Array.from({ length: 10 }, (_, i) => ({
        path: `profile.facts.f${i}`,
        label: `Fact ${i}`,
        value: `Value ${i}`,
        cites: [1],
        source: "documents" as const,
    }));
    mockGetProfile.mockResolvedValue({
        profile: profile({
            facts: [
                ...sourced,
                {
                    path: "profile.facts.idea",
                    label: "The idea",
                    value: "Anvils by subscription.",
                    cites: [],
                    source: "manual",
                },
            ],
        }),
    });
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await user.click(screen.getByRole("button", { name: /Skip this step/ }));

    const list = await screen.findByLabelText("Facts so far");
    const terms = within(list).getAllByRole("term");
    expect(terms).toHaveLength(8);
    expect(terms[0]).toHaveTextContent("The idea · from you");
    expect(screen.getByRole("link", { name: "3 more in the company profile" })).toHaveAttribute(
        "href",
        "/employer/settings#company"
    );
});

describe("going through it again", () => {
    it("shows what the documents say as a hint, and Continue leaves it theirs", async () => {
        const user = userEvent.setup();
        onboardingState = {
            name: "Acme",
            website: null,
            description: null,
            idea: null,
            industry: null,
            saved: { website: false, description: false, idea: false },
            fromSources: {
                website: "https://acme.com/",
                description: "Acme Robotics builds warehouse robots.",
            },
            websiteImported: false,
            canEdit: true,
        };
        await renderLoaded();
        const description = screen.getByLabelText("What does the company do?");
        expect(description).toHaveValue("");
        expect(description).toHaveAttribute(
            "placeholder",
            "From your sources: Acme Robotics builds warehouse robots."
        );
        expect(screen.getByLabelText("Website")).toHaveAttribute(
            "placeholder",
            "From your sources: https://acme.com/"
        );
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("heading", { name: "Add documents about the company" });
        expect(calls.filter(c => c.method === "POST")).toEqual([]);
    });

    beforeEach(() => {
        onboardingState = {
            name: "Acme",
            website: "https://acme.com/",
            description: "We make anvils.",
            idea: "Anvils by subscription.",
            industry: "Manufacturing",
            saved: { website: true, description: true, idea: true },
            websiteImported: true,
            canEdit: true,
        };
    });

    it("sends nothing and imports nothing when nothing changed", async () => {
        const user = userEvent.setup();
        await renderLoaded();
        expect(screen.getByText(/homepage is already a source/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("heading", { name: "Add documents about the company" });
        expect(calls.filter(c => c.method === "POST")).toEqual([]);
    });

    it("sends only what changed", async () => {
        const user = userEvent.setup();
        await renderLoaded();
        const idea = screen.getByLabelText(/idea you.re working on/);
        await user.clear(idea);
        await user.type(idea, "Anvils for rent.");
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("heading", { name: "Add documents about the company" });
        expect(calls.filter(c => c.method === "POST")).toEqual([
            { url: "/api/company/onboarding", method: "POST", body: { idea: "Anvils for rent." } },
        ]);
    });

    it("a description from the company record is still the person's to save", async () => {
        const user = userEvent.setup();
        onboardingState = {
            ...onboardingState,
            website: null,
            idea: null,
            description: "From the workspace picker.",
            saved: { website: false, description: false, idea: false },
            websiteImported: false,
        };
        await renderLoaded();
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("heading", { name: "Add documents about the company" });
        expect(calls.filter(c => c.method === "POST")).toEqual([
            {
                url: "/api/company/onboarding",
                method: "POST",
                body: { description: "From the workspace picker." },
            },
        ]);
    });

    it("imports the homepage when it is saved but not a source (deleted, or never fetched)", async () => {
        const user = userEvent.setup();
        onboardingState = { ...onboardingState, websiteImported: false };
        await renderLoaded();
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("heading", { name: "Add documents about the company" });
        expect(calls.filter(c => c.method === "POST")).toEqual([
            {
                url: "/api/upload/website",
                method: "POST",
                body: { url: "https://acme.com/", category: "Company" },
            },
        ]);
    });

    it("imports a new address", async () => {
        const user = userEvent.setup();
        await renderLoaded();
        const website = screen.getByLabelText("Website");
        await user.clear(website);
        await user.type(website, "acme.io");
        expect(screen.getByText(/We import your homepage/)).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Continue" }));
        await screen.findByRole("heading", { name: "Add documents about the company" });
        expect(calls.filter(c => c.method === "POST").map(c => c.body)).toEqual([
            { website: "https://acme.io/" },
            { url: "https://acme.io/", category: "Company" },
        ]);
    });
});

it("caps each answer at what the server accepts", async () => {
    await renderLoaded();
    expect(screen.getByLabelText("Website")).toHaveAttribute("maxLength", "2048");
    expect(screen.getByLabelText("What does the company do?")).toHaveAttribute("maxLength", "5000");
    expect(screen.getByLabelText(/idea you.re working on/)).toHaveAttribute("maxLength", "5000");
});

it("someone who cannot set up the profile is shown the way out, not a form", async () => {
    const user = userEvent.setup();
    onboardingState = { ...onboardingState, canEdit: false };
    render(<OnboardingFlow />);
    await screen.findByRole("heading", { name: "Setting up Acme" });
    expect(screen.queryByLabelText("Website")).toBeNull();
    expect(screen.getByRole("link", { name: "See the company profile" })).toHaveAttribute(
        "href",
        "/employer/settings#company"
    );
    await user.click(screen.getByRole("button", { name: /Open your workspace/ }));
    expect(mockReplace).toHaveBeenCalledWith("/employer/documents");
});

it("an address that can never be fetched is not offered again", async () => {
    const user = userEvent.setup();
    websiteResponse = {
        status: 400,
        body: { error: "URL resolves to a private or internal address" },
    };
    await renderLoaded();
    await user.type(screen.getByLabelText("Website"), "169.254.169.254.nip.io");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: /Skip this step/ }));
    expect(
        await screen.findByText(/private or internal address\. It stays your website/)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

it("says so when the profile could not be built", async () => {
    const user = userEvent.setup();
    mockGetProfile.mockResolvedValue({
        profile: profile({ status: "failed", error: "The model did not answer" }),
    });
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await user.click(screen.getByRole("button", { name: /Skip this step/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
        "The profile could not be built: The model did not answer. Your answers and sources are kept"
    );
});

it("tells a screen reader how far reading has got", async () => {
    const user = userEvent.setup();
    mockGetProfile.mockResolvedValue({
        profile: profile({
            sources: [
                source({ documentId: 1, facts: 2 }),
                source({ documentId: 2, status: "pending", role: null }),
            ],
            facts: [
                {
                    path: "company.website",
                    label: "Website",
                    value: "https://acme.com/",
                    cites: [],
                    source: "manual",
                },
            ],
        }),
    });
    await renderLoaded();
    await user.click(screen.getByRole("button", { name: "Skip this step" }));
    await user.click(screen.getByRole("button", { name: /Skip this step/ }));
    expect(await screen.findByText("1 of 2 sources read. 1 fact so far.")).toBeInTheDocument();
});

it("going Back after a save and Continue again sends nothing new", async () => {
    const user = userEvent.setup();
    await renderLoaded();
    await user.type(screen.getByLabelText("Website"), "acme.com");
    await user.type(screen.getByLabelText(/idea you.re working on/), "Anvils by subscription.");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Add documents about the company" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Add documents about the company" });
    expect(
        calls.filter(c => c.url === "/api/company/onboarding" && c.method === "POST")
    ).toHaveLength(1);
    expect(calls.filter(c => c.url === "/api/upload/website")).toHaveLength(1);
});

it("shows nothing of the form until it knows who is asking", async () => {
    onboardingState = { ...onboardingState, canEdit: false };
    let answer!: () => void;
    const gate = new Promise<void>(resolve => (answer = resolve));
    const fetchMock = global.fetch as jest.Mock;
    const real = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementationOnce(async (...args: Parameters<typeof fetch>) => {
        await gate;
        return real(...args);
    });
    render(<OnboardingFlow />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByLabelText("Website")).toBeNull();
    expect(screen.queryByRole("button", { name: "Skip setup" })).toBeNull();
    answer();
    await screen.findByRole("heading", { name: "Setting up Acme" });
    expect(screen.queryByLabelText("Website")).toBeNull();
});
