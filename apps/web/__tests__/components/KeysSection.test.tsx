/** @jest-environment jsdom */

/**
 * Settings › Bring your own keys › Embedding key: an OpenAI-compatible key is
 * only usable with the endpoint it belongs to, so the form shows that
 * address, warns when a key is stored without one, and sends the address with
 * a new key. The API key half is `WorkspaceModelPanel.test.tsx`.
 */

import React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { KeysSection } from "~/app/employer/documents/_workspace/settings/KeysSection";
import type { SettingsSectionActions } from "~/app/employer/documents/_workspace/settings/contract";

const GEMINI = {
    indexKey: "gemini-embedding-768",
    provider: "openai",
    model: "gemini-embedding-001",
    dimension: 768,
};

function company(overrides: Record<string, unknown> = {}) {
    return {
        embeddingOpenAIApiKey: { hasKey: true, last4: "1234" },
        embeddingOpenAIBaseUrl: null,
        embeddingModel: GEMINI,
        ...overrides,
    };
}

const fetchMock = jest.fn();

/** jsdom has no `Response`; the section only reads ok, status and json(). */
function respond(
    fetched: ReturnType<typeof company>,
    saved: unknown = { success: true },
    saveStatus = 200
) {
    fetchMock.mockImplementation((url: string) => {
        const [status, body] =
            url === "/api/fetchCompany"
                ? [200, fetched]
                : url === "/api/settings/models/workspace"
                  ? [200, { endpoint: null }]
                  : [saveStatus, saved];
        return Promise.resolve({
            ok: status < 400,
            status,
            json: () => Promise.resolve(body),
        });
    });
}

let actions: SettingsSectionActions | null = null;

async function renderSection() {
    actions = null;
    render(<KeysSection onActions={a => (actions = a)} />);
    await screen.findByLabelText("Embeddings endpoint URL");
    return { save: () => act(async () => actions?.onPrimary?.()) };
}

function savedBody(): Record<string, unknown> {
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/updateCompany");
    return JSON.parse((call![1] as RequestInit).body as string) as Record<string, unknown>;
}

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe("KeysSection: both keys on one page", () => {
    it("offers the API key and the embedding key, and says both are optional", async () => {
        respond(company({ embeddingOpenAIApiKey: { hasKey: false, last4: null } }));
        await renderSection();

        expect(screen.getByRole("heading", { name: "API key" })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "Connect OpenRouter" })).toBeVisible();
        expect(screen.getByRole("heading", { name: "Embedding key" })).toBeInTheDocument();
        expect(screen.getByText("Using the server’s key.")).toBeVisible();
        expect(screen.getAllByText(/^Optional\./)).toHaveLength(2);
    });

    it("keeps Save disabled until something is edited", async () => {
        respond(company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }));
        await renderSection();

        await waitFor(() => expect(actions?.primaryLabel).toBe("Save changes"));
        expect(actions?.disabled).toBe(true);

        await userEvent.type(screen.getByLabelText("Embedding API key"), "sk-new");
        await waitFor(() => expect(actions?.disabled).toBe(false));
    });
});

describe("KeysSection: embedding endpoint URL", () => {
    it("warns when a key is stored without an endpoint URL", async () => {
        respond(company());
        await renderSection();

        expect(
            screen.getByText(/has no endpoint URL, so embedding with it will fail/)
        ).toBeVisible();
        expect(screen.getByText("1234")).toBeVisible();
    });

    it("shows the stored URL and no warning when the pair is complete", async () => {
        respond(company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }));
        await renderSection();

        expect(screen.getByLabelText("Embeddings endpoint URL")).toHaveValue(
            "https://embeddings.example/v1"
        );
        expect(screen.queryByText(/has no endpoint URL/)).not.toBeInTheDocument();
    });

    it("sends the URL together with a new key", async () => {
        respond(company());
        const { save } = await renderSection();

        await userEvent.type(screen.getByLabelText("Embedding API key"), "sk-new-5678");
        await userEvent.type(
            screen.getByLabelText("Embeddings endpoint URL"),
            "https://api.openai.com/v1"
        );
        await save();

        expect(savedBody()).toEqual({
            embeddingOpenAIApiKey: "sk-new-5678",
            embeddingOpenAIBaseUrl: "https://api.openai.com/v1",
        });
        await waitFor(() =>
            expect(screen.queryByText(/has no endpoint URL/)).not.toBeInTheDocument()
        );
        expect(screen.getByText("5678")).toBeVisible();
        expect(screen.getByLabelText("Embedding API key")).toHaveValue("");
    });

    it("sends only the key when the URL was not changed", async () => {
        respond(company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }));
        const { save } = await renderSection();

        await userEvent.type(screen.getByLabelText("Embedding API key"), "sk-rotated-0000");
        await save();

        expect(savedBody()).toEqual({
            embeddingOpenAIApiKey: "sk-rotated-0000",
            embeddingOpenAIBaseUrl: "https://embeddings.example/v1",
        });
    });

    it("shows the server's refusal when the address changes without the key", async () => {
        respond(
            company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }),
            {
                success: false,
                code: "EMBEDDING_KEY_REQUIRED",
                message:
                    "The embeddings endpoint changed, so enter the API key for the new address.",
            },
            400
        );
        const { save } = await renderSection();

        const url = screen.getByLabelText("Embeddings endpoint URL");
        await userEvent.clear(url);
        await userEvent.type(url, "https://other.example/v1");
        await save();

        expect(savedBody()).toEqual({ embeddingOpenAIBaseUrl: "https://other.example/v1" });
        expect(await screen.findByRole("alert")).toHaveTextContent(/enter the API key/);
    });
});

describe("KeysSection: which model the key has to run", () => {
    it("names the model the workspace's index embeds with", async () => {
        respond(company());
        await renderSection();

        expect(screen.getByText("gemini-embedding-001")).toBeVisible();
        expect(screen.getByText(/the endpoint has to serve that model/)).toBeVisible();
    });

    it("says the key goes unused when the index isn't OpenAI-compatible", async () => {
        respond(
            company({
                embeddingModel: {
                    indexKey: "ollama-default",
                    provider: "ollama",
                    model: "nomic-embed-text",
                    dimension: 768,
                },
            })
        );
        await renderSection();

        expect(screen.getByText(/doesn’t use an OpenAI-compatible key/)).toBeVisible();
    });

    it("says nothing about the model when the server can't name it", async () => {
        respond(company({ embeddingModel: null }));
        await renderSection();

        expect(screen.queryByText(/index embeds with/)).not.toBeInTheDocument();
    });
});

describe("KeysSection: removing the embedding key", () => {
    it("clears the key and its endpoint only after the admin confirms", async () => {
        respond(company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }));
        await renderSection();

        await userEvent.click(screen.getByRole("button", { name: "Remove" }));
        const dialog = await screen.findByTestId("confirm-dialog");
        expect(fetchMock.mock.calls.some(([url]) => url === "/api/updateCompany")).toBe(false);

        await userEvent.click(within(dialog).getByTestId("confirm-accept"));

        await waitFor(() =>
            expect(savedBody()).toEqual({
                embeddingOpenAIApiKey: null,
                embeddingOpenAIBaseUrl: null,
            })
        );
        expect(await screen.findByText(/Embeddings run on the server's key again/)).toBeVisible();
        expect(screen.getByText("Using the server’s key.")).toBeVisible();
        expect(screen.getByLabelText("Embeddings endpoint URL")).toHaveValue("");
        expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });

    it("offers no Remove when there is nothing saved", async () => {
        respond(company({ embeddingOpenAIApiKey: { hasKey: false, last4: null } }));
        await renderSection();

        expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    });
});

describe("KeysSection: a refusal from request validation", () => {
    it("shows the `error` field when there is no `message`", async () => {
        respond(
            company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }),
            { error: "Invalid request data: embeddingOpenAIApiKey: OpenAI API key is too long" },
            400
        );
        const { save } = await renderSection();

        await userEvent.type(screen.getByLabelText("Embedding API key"), "sk-x");
        await save();

        expect(await screen.findByRole("alert")).toHaveTextContent(/OpenAI API key is too long/);
    });
});
