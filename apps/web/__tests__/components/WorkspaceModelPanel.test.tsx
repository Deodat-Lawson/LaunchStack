/** @jest-environment jsdom */

/**
 * Workspace › Bring your own keys › API key.
 *
 * What a workspace admin sees and sends when bringing their own model: the
 * two ways in, the editor's request body (a blank key keeps the saved one
 * only while the address is unchanged), the connected summary, which says
 * which key is saved without ever showing it, the OpenRouter return leg, and
 * each model's optional price (filled from OpenRouter's catalogue when empty).
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

// For the Workspace tab test at the end: an owner, with no router.
jest.mock("next/navigation", () => ({
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), refresh: jest.fn() }),
    usePathname: () => "/employer/documents",
}));
jest.mock("~/lib/use-permissions", () => ({
    usePermissions: () => ({ loaded: true, error: null, roleName: "Owner", can: () => true }),
    setWorkspaceNameLocally: jest.fn(),
}));

import { WorkspaceTool } from "~/app/employer/documents/_workspace/WorkspaceTool";
import { KeysSection } from "~/app/employer/documents/_workspace/settings/KeysSection";
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
            return respond({
                models: ["zeta/chat", "alpha/chat"],
                // OpenRouter's catalogue prices some of what it lists.
                prices: { "alpha/chat": { input: 3, output: 15, cachedInput: 0.3 } },
            });
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
        <KeysSection
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

/** A route's price pair, inside its group. */
function priceOf(route: RegExp) {
    const group = within(screen.getByRole("group", { name: route }));
    const prices = within(group.getByRole("group", { name: /Price per 1M tokens/ }));
    return {
        input: () => prices.getByRole("textbox", { name: "Input" }),
        output: () => prices.getByRole("textbox", { name: "Output" }),
        group: prices,
    };
}

describe("Workspace › Bring your own keys › API key", () => {
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
        expect(screen.getByRole("heading", { name: "API key" })).toBeInTheDocument();
        // The embedding key that once sat below it is gone.
        expect(screen.queryByRole("heading", { name: "Embedding key" })).not.toBeInTheDocument();
        // With the editor closed, the section has no action of its own.
        await waitFor(() => expect(actions?.primaryLabel).toBeUndefined());
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

    it("starts 'Follows a JSON schema' from the new provider's default when the provider changes", async () => {
        stored = {
            ...CONNECTED,
            models: {
                default: { id: "main-1", vision: false, reasoning: false, structuredOutput: true },
            },
        };
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Edit" }));
        const schemaBox = () =>
            within(screen.getByRole("group", { name: /Main model/ })).getByRole("checkbox", {
                name: /Follows a JSON schema/,
            });
        expect(schemaBox()).toBeChecked();

        // Anthropic's compatible API ignores response_format.
        await user.click(screen.getByRole("combobox", { name: "Provider" }));
        await user.click(await screen.findByRole("option", { name: "Anthropic (Claude)" }));
        expect(schemaBox()).not.toBeChecked();

        // Back on the saved provider, the saved choice returns.
        await user.click(screen.getByRole("combobox", { name: "Provider" }));
        await user.click(await screen.findByRole("option", { name: "OpenAI" }));
        expect(schemaBox()).toBeChecked();
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
            // OpenAI enforces json_schema, so that box starts ticked.
            models: {
                default: { id: "main-2", vision: false, reasoning: false, structuredOutput: true },
            },
        });
        expect(puts[0]).not.toHaveProperty("apiKey");

        // Back on the summary, where the section has no action of its own.
        expect(await screen.findByText("main-2")).toBeInTheDocument();
        await waitFor(() => expect(actions?.primaryLabel).toBeUndefined());
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
            default: { id: "main-1", vision: false, reasoning: false, structuredOutput: true },
            reasoning: { id: "thinker-1", vision: false, reasoning: true, structuredOutput: true },
        });
    });

    it("lets the admin say a model doesn't follow a JSON schema", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        renderSection();

        await user.click(await screen.findByRole("button", { name: "Edit" }));
        const main = screen.getByRole("group", { name: /Main model/ });
        const box = within(main).getByRole("checkbox", { name: /Follows a JSON schema/ });
        expect(box).toBeChecked();
        await user.click(box);
        await waitFor(() => expect(actions?.disabled).toBe(false));
        await pressPrimary();

        expect(puts[0]?.models).toEqual({
            default: { id: "main-1", vision: false, reasoning: false, structuredOutput: false },
        });
    });

    describe("a model's price", () => {
        it("renders an optional pair under the main model and sends it with the model", async () => {
            stored = CONNECTED;
            const user = userEvent.setup();
            renderSection();

            await user.click(await screen.findByRole("button", { name: "Edit" }));
            const main = priceOf(/Main model/);
            expect(main.input()).toHaveValue("");
            expect(main.output()).toHaveValue("");
            expect(main.input()).toHaveAttribute("inputmode", "decimal");
            expect(
                main.group.getByText(/What your provider charges, in US dollars/)
            ).toBeInTheDocument();
            expect(main.group.getByText(/its tokens count one for one/)).toBeInTheDocument();

            await user.type(main.input(), "3");
            await user.type(main.output(), "15");
            await waitFor(() => expect(actions?.disabled).toBe(false));
            await pressPrimary();

            expect(puts[0]?.models).toEqual({
                default: {
                    id: "main-1",
                    vision: false,
                    reasoning: false,
                    structuredOutput: true,
                    pricing: { input: 3, output: 15 },
                },
            });
            // The summary says what was saved.
            expect(
                await screen.findByText(/\$3\.00 in, \$15\.00 out per 1M tokens/)
            ).toBeInTheDocument();
        });

        it("loads a saved price, and clearing it removes it", async () => {
            stored = {
                ...CONNECTED,
                models: {
                    default: {
                        id: "main-1",
                        vision: false,
                        reasoning: false,
                        pricing: { input: 2, output: 8, cachedInput: 0.2 },
                    },
                },
            };
            const user = userEvent.setup();
            renderSection();

            expect(
                await screen.findByText(/\$2\.00 in, \$8\.00 out per 1M tokens/)
            ).toBeInTheDocument();
            await user.click(screen.getByRole("button", { name: "Edit" }));
            const main = priceOf(/Main model/);
            expect(main.input()).toHaveValue("2");
            expect(main.output()).toHaveValue("8");

            // Saved untouched, the cached-input price it came with stays.
            await pressPrimary();
            expect((puts[0]?.models as Body).default).toMatchObject({
                pricing: { input: 2, output: 8, cachedInput: 0.2 },
            });

            await user.click(await screen.findByRole("button", { name: "Edit" }));
            await user.clear(priceOf(/Main model/).input());
            await user.clear(priceOf(/Main model/).output());
            await waitFor(() => expect(actions?.disabled).toBe(false));
            await pressPrimary();
            expect((puts[1]?.models as Body).default).not.toHaveProperty("pricing");
            await waitFor(() =>
                expect(screen.queryByText(/out per 1M tokens/)).not.toBeInTheDocument()
            );
        });

        it("refuses half a price and a price out of range", async () => {
            stored = CONNECTED;
            const user = userEvent.setup();
            renderSection();

            await user.click(await screen.findByRole("button", { name: "Edit" }));
            const main = priceOf(/Main model/);
            await user.type(main.input(), "3");
            expect(
                main.group.getByText("Give both an input and an output price, or leave both empty.")
            ).toBeInTheDocument();
            expect(main.input()).toHaveAttribute("aria-invalid", "true");
            await waitFor(() => expect(actions?.disabled).toBe(true));

            await user.type(main.output(), "20000");
            expect(
                main.group.getByText(
                    "A price is a number from 0 to 10,000, in US dollars per 1M tokens."
                )
            ).toBeInTheDocument();
            expect(actions?.disabled).toBe(true);

            await user.clear(main.output());
            await user.type(main.output(), "abc");
            expect(main.group.getByText(/A price is a number/)).toBeInTheDocument();

            await user.clear(main.output());
            await user.type(main.output(), "0.6");
            await waitFor(() => expect(actions?.disabled).toBe(false));
        });

        it("gives a routed model its own price once it is chosen", async () => {
            stored = CONNECTED;
            const user = userEvent.setup();
            renderSection();

            await user.click(await screen.findByRole("button", { name: "Edit" }));
            await user.click(screen.getByRole("button", { name: /Use different models/ }));
            const fast = screen.getByRole("group", { name: /^Fast/ });
            expect(
                within(fast).queryByRole("group", { name: /Price per 1M tokens/ })
            ).not.toBeInTheDocument();

            await user.type(within(fast).getByRole("combobox"), "small-1");
            await user.type(priceOf(/^Fast/).input(), "0.15");
            await user.type(priceOf(/^Fast/).output(), "0.6");
            await waitFor(() => expect(actions?.disabled).toBe(false));
            await pressPrimary();

            expect(puts[0]?.models).toEqual({
                default: { id: "main-1", vision: false, reasoning: false, structuredOutput: true },
                fast: {
                    id: "small-1",
                    vision: false,
                    reasoning: false,
                    structuredOutput: true,
                    pricing: { input: 0.15, output: 0.6 },
                },
            });
        });

        it("fills an empty price from OpenRouter's catalogue when the admin picks a model", async () => {
            window.history.replaceState(null, "", "/employer/documents?openrouter=connected#byok");
            stored = OPENROUTER_FRESH;
            const user = userEvent.setup();
            renderSection();

            await waitFor(() => expect(listed).toHaveLength(1));
            const main = priceOf(/Main model/);
            await user.type(mainModel(), "alpha/chat");
            expect(main.input()).toHaveValue("3");
            expect(main.output()).toHaveValue("15");

            // Another pick replaces the catalogue's price; one it doesn't price clears it.
            await user.clear(mainModel());
            await user.type(mainModel(), "zeta/chat");
            expect(main.input()).toHaveValue("");
            expect(main.output()).toHaveValue("");

            await user.clear(mainModel());
            await user.type(mainModel(), "alpha/chat");
            await waitFor(() => expect(actions?.disabled).toBe(false));
            await pressPrimary();
            expect((puts[0]?.models as Body).default).toEqual({
                id: "alpha/chat",
                vision: false,
                reasoning: false,
                structuredOutput: true,
                pricing: { input: 3, output: 15, cachedInput: 0.3 },
            });
        });

        it("never replaces a price the admin typed", async () => {
            window.history.replaceState(null, "", "/employer/documents?openrouter=connected#byok");
            stored = OPENROUTER_FRESH;
            const user = userEvent.setup();
            renderSection();

            await waitFor(() => expect(listed).toHaveLength(1));
            const main = priceOf(/Main model/);
            await user.type(main.input(), "1");
            await user.type(main.output(), "2");
            await user.type(mainModel(), "alpha/chat");
            expect(main.input()).toHaveValue("1");
            expect(main.output()).toHaveValue("2");

            await pressPrimary();
            expect((puts[0]?.models as Body).default).toMatchObject({
                pricing: { input: 1, output: 2 },
            });
        });

        it("fills a chosen model's empty price when the list arrives, but not a saved one", async () => {
            stored = {
                ...OPENROUTER_FRESH,
                models: {
                    default: { id: "alpha/chat", vision: false, reasoning: false },
                    fast: {
                        id: "alpha/chat",
                        vision: false,
                        reasoning: false,
                        pricing: { input: 1, output: 2 },
                    },
                },
                active: true,
            };
            const user = userEvent.setup();
            renderSection();

            await user.click(await screen.findByRole("button", { name: "Edit" }));
            await user.click(screen.getByRole("button", { name: "Load models" }));
            await waitFor(() => expect(priceOf(/Main model/).input()).toHaveValue("3"));
            expect(priceOf(/Main model/).output()).toHaveValue("15");
            expect(priceOf(/^Fast/).input()).toHaveValue("1");
            expect(priceOf(/^Fast/).output()).toHaveValue("2");
        });
    });

    it("shows which key is saved without ever showing the key", async () => {
        stored = CONNECTED;
        const user = userEvent.setup();
        const { container } = renderSection();

        expect(await screen.findByText("Key ending wxyz")).toBeInTheDocument();
        expect(screen.getByText("Active")).toBeInTheDocument();
        expect(screen.getByText(/Last changed by Ada Lovelace, 5 min ago/)).toBeInTheDocument();

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
            "/employer/documents?feature=settings&openrouter=connected#byok"
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
        expect(window.location.hash).toBe("#byok");

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
        window.history.replaceState(null, "", `/employer/documents?openrouter=${outcome}#byok`);
        renderSection();

        expect(await screen.findByText(message)).toBeInTheDocument();
        expect(window.location.search).toBe("");
        expect(window.location.hash).toBe("#byok");
    });

    it("lands the OpenRouter return on Workspace › Bring your own keys with its outcome", async () => {
        // The callback sends `?feature=workspace&at=/byok&openrouter=…`; the
        // shell opens the tab on Bring your own keys and strips `feature` and
        // `at`, leaving the outcome for the section to read.
        window.history.replaceState(null, "", "/employer/documents?openrouter=connected");
        stored = OPENROUTER_FRESH;
        render(<WorkspaceTool host={{ active: true, request: { at: "/byok", nonce: 1 } }} />);

        await waitFor(() =>
            expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
                "Bring your own keys"
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

describe("Workspace › Models", () => {
    beforeEach(() => {
        stored = null;
        serve();
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    function renderModels() {
        actions = null;
        return render(<ModelsSection onActions={next => (actions = next)} />);
    }

    it("shows the server default read-only, with nothing to set up here", async () => {
        renderModels();

        expect(await screen.findByRole("heading", { name: "Server default" })).toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Connect OpenRouter" })
        ).not.toBeInTheDocument();
        expect(screen.queryByText(/Bring your own keys/)).not.toBeInTheDocument();
        await waitFor(() => expect(actions?.primaryLabel).toBe("Re-read"));
    });

    it("says the default is unused when the workspace runs on its own model", async () => {
        stored = CONNECTED;
        renderModels();

        expect(
            await screen.findByText(/runs on its own model, set up in Bring your own keys/)
        ).toBeInTheDocument();
    });

    it("says a connected key with no model chosen still runs on the default", async () => {
        stored = OPENROUTER_FRESH;
        renderModels();

        expect(
            await screen.findByText(
                /has no model chosen yet, so it still runs on the server default/
            )
        ).toBeInTheDocument();
    });
});
