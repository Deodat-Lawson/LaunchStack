/** @jest-environment jsdom */

/**
 * Settings › Models › Your own model.
 *
 * What a workspace admin sees and sends when bringing their own model: the
 * two ways in, the editor's request body (a blank key keeps the saved one
 * only while the address is unchanged), the connected summary, which says
 * which key is saved without ever showing it, and the OpenRouter return leg.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// For the hub test at the end: an owner, with no router or account body.
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
    usePathname: () => "/employer/documents",
}));
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({ loaded: true, error: null, roleName: "Owner", can: () => true }),
}));
jest.mock("~/app/employer/documents/_workspace/settings/AccountSection", () => ({
    AccountSection: () => <div data-testid="body-account">account body</div>,
}));

import { SettingsHub } from "~/app/employer/documents/_workspace/SettingsHub";
import { ModelsSection } from "~/app/employer/documents/_workspace/settings/ModelsSection";
import type { SettingsSectionActions } from "~/app/employer/documents/_workspace/settings/contract";
import type { WorkspaceEndpointView } from "~/app/employer/documents/_workspace/settings/WorkspaceModelPanel";

const OVERVIEW = {
    routes: [{ route: "default", available: true, name: "Main model", inheritsDefault: false }],
    models: [
        {
            name: "Main model",
            fromPreset: true,
            input: ["text"],
            vision: false,
            reasoning: false,
            reasoningMode: "none",
            structuredOutput: [],
            contextTokens: null,
            maxOutputTokens: null,
            routes: ["default"],
        },
    ],
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const CONNECTED: WorkspaceEndpointView = {
    provider: "openai",
    baseUrl: "https://api.openai.com/v1",
    hasKey: true,
    keyLast4: "wxyz",
    models: { default: { id: "main-1", vision: false, reasoning: false } },
    active: true,
    connectedVia: "key",
    updatedAt: minutesAgo(5),
    updatedBy: "Ada Lovelace",
};

const OPENROUTER_FRESH: WorkspaceEndpointView = {
    provider: "openrouter",
    baseUrl: "https://openrouter.ai/api/v1",
    hasKey: true,
    keyLast4: "9f3a",
    models: null,
    active: false,
    connectedVia: "openrouter",
    updatedAt: minutesAgo(0),
    updatedBy: "Ada Lovelace",
};

const respond = (body: unknown, status = 200) =>
    Promise.resolve({ ok: status < 400, status, json: async () => body } as unknown as Response);

type Body = Record<string, unknown>;

let stored: WorkspaceEndpointView | null;
let puts: Body[];
let deletes: number;
let listed: Body[];
let tested: Body[];
let actions: SettingsSectionActions | null;
const originalFetch = global.fetch;

/** A stand-in for the workspace model routes, keeping what was saved. */
function serve() {
    global.fetch = jest.fn((url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const body = init?.body ? (JSON.parse(init.body as string) as Body) : {};
        if (url === "/api/settings/models") return respond(OVERVIEW);
        if (url === "/api/settings/models/workspace") {
            if (method === "GET") return respond({ endpoint: stored });
            if (method === "DELETE") {
                deletes += 1;
                stored = null;
                return respond({ endpoint: null });
            }
            if (method === "PUT") {
                puts.push(body);
                const typed = typeof body.apiKey === "string" ? body.apiKey : null;
                const models = body.models as WorkspaceEndpointView["models"];
                stored = {
                    ...(stored ?? CONNECTED),
                    provider: body.provider as WorkspaceEndpointView["provider"],
                    baseUrl: body.baseUrl as string,
                    hasKey: body.apiKey === null ? false : typed ? true : Boolean(stored?.hasKey),
                    keyLast4:
                        body.apiKey === null
                            ? null
                            : typed
                              ? typed.slice(-4)
                              : (stored?.keyLast4 ?? null),
                    models,
                    active: Boolean(models?.default.id),
                    updatedAt: minutesAgo(0),
                };
                return respond({ endpoint: stored });
            }
        }
        if (url === "/api/settings/models/workspace/models") {
            listed.push(body);
            return respond({ models: ["zeta/chat", "alpha/chat"] });
        }
        if (url === "/api/settings/models/workspace/test") {
            tested.push(body);
            return respond({
                ok: true,
                results: [{ route: "default", modelId: "main-1", ok: true, latencyMs: 1234 }],
            });
        }
        throw new Error(`unexpected fetch ${method} ${url}`);
    }) as unknown as typeof fetch;
}

function renderSection() {
    actions = null;
    return render(
        <ModelsSection
            onActions={next => {
                actions = next;
            }}
        />
    );
}

/** The section's published primary action, as the settings chrome would run it. */
async function pressPrimary() {
    await act(async () => {
        await actions?.onPrimary?.();
    });
}

const mainModel = () =>
    // An input with suggestions (`list`) is a combobox.
    screen.getByRole("combobox", { name: "Main model" });

describe("Settings › Models › Your own model", () => {
    beforeAll(() => {
        // Radix Select reaches for layout APIs jsdom lacks.
        Element.prototype.scrollIntoView = jest.fn();
        Element.prototype.hasPointerCapture = jest.fn(() => false);
        Element.prototype.releasePointerCapture = jest.fn();
    });

    beforeEach(() => {
        window.history.replaceState(null, "", "/");
        stored = null;
        puts = [];
        deletes = 0;
        listed = [];
        tested = [];
        serve();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    it("offers both ways in when the workspace has no model of its own", async () => {
        renderSection();

        expect(await screen.findByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
        expect(screen.getByRole("button", { name: "Use an API key" })).toBeVisible();
        expect(screen.getByRole("heading", { name: "Your own model" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "Server default" })).toBeInTheDocument();
        expect(screen.queryByText(/uses its own model/)).not.toBeInTheDocument();
        await waitFor(() => expect(actions?.primaryLabel).toBe("Re-read"));
    });

    it("fills the base URL from the provider an admin picks", async () => {
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Use an API key" }));
        expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.openai.com/v1");
        await waitFor(() => expect(actions?.primaryLabel).toBe("Save"));
        // Nothing to save yet: no key, no model.
        expect(actions?.disabled).toBe(true);

        await user.click(screen.getByRole("combobox", { name: "Provider" }));
        await user.click(await screen.findByRole("option", { name: "Google Gemini" }));

        expect(screen.getByLabelText("Base URL")).toHaveValue(
            "https://generativelanguage.googleapis.com/v1beta/openai"
        );
        expect(screen.getByRole("link", { name: /Get a key/ })).toHaveAttribute(
            "href",
            "https://aistudio.google.com/apikey"
        );
        expect(screen.getByLabelText("API key")).toHaveAttribute("type", "password");
    });

    it("keeps the saved key by leaving apiKey out when the key is blank and the address unchanged", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Edit" }));
        expect(screen.getByLabelText("API key")).toHaveAttribute(
            "placeholder",
            "Leave blank to keep the key ending wxyz"
        );
        await user.clear(mainModel());
        await user.type(mainModel(), "main-2");

        await waitFor(() => expect(actions?.disabled).toBe(false));
        expect(actions?.primaryLabel).toBe("Save");
        await pressPrimary();

        expect(puts).toHaveLength(1);
        expect(puts[0]).toEqual({
            provider: "openai",
            baseUrl: "https://api.openai.com/v1",
            models: { default: { id: "main-2", vision: false, reasoning: false } },
        });
        expect(puts[0]).not.toHaveProperty("apiKey");

        // Back on the summary, with Re-read as the section's action again.
        expect(await screen.findByText("main-2")).toBeInTheDocument();
        await waitFor(() => expect(actions?.primaryLabel).toBe("Re-read"));
    });

    it("asks for the key again when the address changes", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Edit" }));
        const url = screen.getByLabelText("Base URL");
        await user.clear(url);
        await user.type(url, "https://llm.example.com/v1");

        expect(screen.getByLabelText("API key")).toHaveAttribute(
            "placeholder",
            "Paste your API key"
        );
        expect(screen.getByText(/The address changed, so enter the key/)).toBeInTheDocument();
        await waitFor(() => expect(actions?.disabled).toBe(true));
    });

    it("sends routed models with what the admin declared, and refuses a non-reasoning model for reasoning", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Edit" }));
        await user.click(screen.getByRole("button", { name: /Use different models/ }));
        const reasoning = screen.getByRole("group", { name: /Reasoning/ });
        await user.type(within(reasoning).getByRole("combobox"), "thinker-1");

        expect(within(reasoning).getByText(/Only a reasoning model/)).toBeInTheDocument();
        await waitFor(() => expect(actions?.disabled).toBe(true));

        await user.click(within(reasoning).getByRole("checkbox", { name: /Reasons step by step/ }));
        await waitFor(() => expect(actions?.disabled).toBe(false));
        await pressPrimary();

        expect(puts[0]?.models).toEqual({
            default: { id: "main-1", vision: false, reasoning: false },
            reasoning: { id: "thinker-1", vision: false, reasoning: true },
        });
    });

    it("shows which key is saved without ever showing the key", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        const { container } = renderSection();

        expect(await screen.findByText("Key ending wxyz")).toBeInTheDocument();
        expect(screen.getByText("Active")).toBeInTheDocument();
        expect(screen.getByText(/Last changed by Ada Lovelace, 5 min ago/)).toBeInTheDocument();
        expect(screen.getByText(/uses its own model, so the server default/)).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Edit" }));
        await user.type(screen.getByLabelText("API key"), "sk-SECRET-0123abcd");
        await pressPrimary();

        expect(puts[0]?.apiKey).toBe("sk-SECRET-0123abcd");
        expect(await screen.findByText("Key ending abcd")).toBeInTheDocument();
        expect(container.textContent).not.toContain("SECRET");
        for (const input of Array.from(container.querySelectorAll("input"))) {
            expect(input.value).not.toContain("SECRET");
        }
    });

    it("tests the saved setup and reports each route", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Test" }));

        expect(await screen.findByText("Answered in 1.2 s")).toBeInTheDocument();
        expect(screen.getByText("Every model answered.")).toBeInTheDocument();
        // The saved key stays on the server: the test names no key.
        expect(tested[0]).toEqual({
            provider: "openai",
            baseUrl: "https://api.openai.com/v1",
            models: CONNECTED.models,
        });
    });

    it("disconnects only after the admin confirms", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Disconnect" }));
        const dialog = await screen.findByTestId("confirm-dialog");
        expect(
            within(dialog).getByText(
                "This workspace goes back to the server's default models and the saved key is deleted."
            )
        ).toBeInTheDocument();
        expect(deletes).toBe(0);

        await user.click(within(dialog).getByTestId("confirm-accept"));

        expect(await screen.findByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
        expect(deletes).toBe(1);
    });

    it("comes back from OpenRouter with a message and the editor open at the model step", async () => {
        window.history.replaceState(
            null,
            "",
            "/employer/documents?feature=settings&openrouter=connected#models"
        );
        stored = OPENROUTER_FRESH;
        renderSection();

        expect(
            await screen.findByText(
                "OpenRouter is connected. Choose a model to switch your workspace over."
            )
        ).toBeInTheDocument();
        // The outcome is read once; the rest of the address stays.
        expect(window.location.search).toBe("?feature=settings");
        expect(window.location.hash).toBe("#models");

        await waitFor(() => expect(mainModel()).toHaveFocus());
        expect(screen.getByLabelText("API key")).toHaveAttribute(
            "placeholder",
            "Leave blank to keep the key ending 9f3a"
        );
        // The saved key lists the models; the suggestions arrive sorted.
        await waitFor(() => expect(listed).toHaveLength(1));
        expect(listed[0]).toEqual({
            provider: "openrouter",
            baseUrl: "https://openrouter.ai/api/v1",
        });
        const options = Array.from(document.querySelectorAll("datalist option")).map(o =>
            o.getAttribute("value")
        );
        expect(options).toEqual(["alpha/chat", "zeta/chat"]);
    });

    it.each([
        ["denied", "OpenRouter sign-in was cancelled. Nothing changed."],
        ["expired", "That sign-in expired, try again."],
        ["error", "Couldn't connect OpenRouter. Try again, or use an API key instead."],
    ])("says what happened when OpenRouter returns %s", async (outcome, message) => {
        window.history.replaceState(null, "", `/employer/documents?openrouter=${outcome}#models`);
        renderSection();

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(window.location.search).toBe("");
        expect(window.location.hash).toBe("#models");
    });

    it("lands the OpenRouter return on Models even after the shell dropped the #models hash", async () => {
        // The workspace shell strips `?feature=settings` with a router.replace
        // that loses the hash, usually before the lazy hub mounts.
        window.history.replaceState(null, "", "/employer/documents?openrouter=connected");
        stored = OPENROUTER_FRESH;
        render(<SettingsHub embedded />);

        await waitFor(() =>
            expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
                "Which model serves each kind of request"
            )
        );
        expect(
            await screen.findByText(
                "OpenRouter is connected. Choose a model to switch your workspace over."
            )
        ).toBeInTheDocument();
        expect(window.location.search).toBe("");
    });
});
