/** @jest-environment jsdom */

/**
 * Settings › Processing: the OpenAI-compatible embeddings key is only usable
 * with the endpoint it belongs to, so the form shows that address, warns when
 * a key is stored without one, and sends the address with a new key.
 */

import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";

import { ProcessingSettings } from "~/app/employer/documents/_workspace/settings/ProcessingSettings";
import type { SettingsSectionActions } from "~/app/employer/documents/_workspace/settings/contract";

function company(overrides: Record<string, unknown> = {}) {
    return {
        id: 7,
        name: "Acme",
        embeddingIndexKey: "legacy-openai-1536",
        embeddingOpenAIApiKey: { hasKey: true, last4: "1234" },
        embeddingOpenAIBaseUrl: null,
        embeddingHuggingFaceApiKey: { hasKey: false, last4: null },
        embeddingOllamaBaseUrl: null,
        embeddingOllamaModel: null,
        numberOfEmployees: "0",
        createdAt: "",
        updatedAt: "",
        ...overrides,
    };
}

const fetchMock = jest.fn();

/** jsdom has no `Response`; the component only reads ok, status and json(). */
function respond(
    fetched: ReturnType<typeof company>,
    saved: unknown = { success: true },
    saveStatus = 200
) {
    fetchMock.mockImplementation((url: string) => {
        const status = url === "/api/fetchCompany" ? 200 : saveStatus;
        const body = url === "/api/fetchCompany" ? fetched : saved;
        return Promise.resolve({
            ok: status < 400,
            status,
            json: () => Promise.resolve(body),
        });
    });
}

async function renderSection() {
    let actions: SettingsSectionActions | null = null;
    render(<ProcessingSettings onActions={a => (actions = a)} />);
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

describe("ProcessingSettings: embeddings endpoint URL", () => {
    it("warns when a key is stored without an endpoint URL", async () => {
        respond(company());
        await renderSection();

        expect(
            screen.getByText(/has no endpoint URL, so embedding with it will fail/)
        ).toBeVisible();
        expect(screen.getByText(/ending 1234 · no endpoint URL/)).toBeVisible();
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

        await userEvent.type(screen.getByLabelText("OpenAI-compatible API key"), "sk-new-5678");
        await userEvent.type(
            screen.getByLabelText("Embeddings endpoint URL"),
            "https://api.openai.com/v1"
        );
        await save();

        expect(savedBody()).toMatchObject({
            embeddingOpenAIApiKey: "sk-new-5678",
            embeddingOpenAIBaseUrl: "https://api.openai.com/v1",
        });
        await waitFor(() =>
            expect(screen.queryByText(/has no endpoint URL/)).not.toBeInTheDocument()
        );
    });

    it("leaves the URL out when it was not changed", async () => {
        respond(company({ embeddingOpenAIBaseUrl: "https://embeddings.example/v1" }));
        const { save } = await renderSection();

        await userEvent.selectOptions(screen.getByRole("combobox"), "ollama-768");
        await userEvent.selectOptions(screen.getByRole("combobox"), "legacy-openai-1536");
        await save();

        expect(savedBody()).not.toHaveProperty("embeddingOpenAIBaseUrl");
        expect(savedBody()).not.toHaveProperty("embeddingOpenAIApiKey");
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

        expect(savedBody()).toMatchObject({ embeddingOpenAIBaseUrl: "https://other.example/v1" });
        expect(savedBody()).not.toHaveProperty("embeddingOpenAIApiKey");
        expect(await screen.findByRole("alert")).toHaveTextContent(/enter the API key/);
    });
});
