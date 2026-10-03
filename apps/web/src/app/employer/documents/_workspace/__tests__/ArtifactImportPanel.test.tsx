/** @jest-environment jsdom */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

import { ArtifactImportPanel } from "../ArtifactImportPanel";

/**
 * Add a source → Claude artifact. What matters is what reaches the server:
 * the file is stored as plain text whatever the artifact is (so opening it
 * can never run it on this origin), read by ingestion as its real type, and
 * registered with the marker that makes the viewer sandbox it — through the
 * same two calls every uploaded file makes.
 */

interface Call {
    url: string;
    method: string;
    body?: unknown;
}

function mockServer(legacy: { id: number; title: string; artifactType: string }[] = []) {
    const calls: Call[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? "GET";
        let body: unknown = init?.body;
        if (body instanceof FormData) {
            // jsdom's File has no text(); the name and type are what matter.
            const file = body.get("file") as File;
            body = { name: file.name, type: file.type };
        } else if (typeof body === "string") {
            body = JSON.parse(body);
        }
        calls.push({ url, method, body });
        // jsdom has no Response; the panel reads only these.
        const json = (value: unknown, status = 200) => ({
            ok: status < 400,
            status,
            json: async () => value,
            text: async () => JSON.stringify(value),
        });
        if (url.startsWith("/api/artifacts?")) return json({ artifacts: legacy, folders: [] });
        if (url.startsWith("/api/artifacts/") && method === "GET") {
            const id = Number(url.split("/").pop());
            const item = legacy.find(a => a.id === id)!;
            return json({ artifact: { ...item, sourceUrl: null, content: "graph TD; A-->B" } });
        }
        if (url.startsWith("/api/artifacts/") && method === "DELETE") return json({ ok: true });
        if (url === "/api/upload-local") return json({ url: "/api/files/9", provider: "database" });
        if (url === "/api/uploadDocument") return json({ success: true }, 202);
        return json({ error: "unexpected" }, 500);
    }) as unknown as typeof fetch;
    return calls;
}

describe("ArtifactImportPanel", () => {
    it("adds pasted HTML as a source, stored as text and marked as an artifact", async () => {
        const calls = mockServer();
        const onUploaded = jest.fn();
        render(<ArtifactImportPanel userId="u1" category="Research" onUploaded={onUploaded} />);

        fireEvent.change(screen.getByLabelText("Artifact code"), {
            target: {
                value: "<!doctype html><html><head><title>Revenue board</title></head><body><script>1</script></body></html>",
            },
        });
        // Detected, and titled from the page itself.
        expect(screen.getByText("Type (detected)")).toBeInTheDocument();
        expect(screen.getByLabelText("Title")).toHaveAttribute("placeholder", "Revenue board");

        fireEvent.click(screen.getByRole("button", { name: "Add as source" }));
        await waitFor(() => expect(onUploaded).toHaveBeenCalled());

        const stored = calls.find(call => call.url === "/api/upload-local")!;
        expect(stored.body).toMatchObject({ name: "Revenue-board.html", type: "text/plain" });
        const registered = calls.find(call => call.url === "/api/uploadDocument")!;
        expect(registered.body).toMatchObject({
            documentName: "Revenue board",
            category: "Research",
            documentUrl: "/api/files/9",
            mimeType: "text/html",
            artifact: { artifactType: "html", sourceUrl: null },
        });
    });

    it("will not send a link to the original that is not http(s)", () => {
        mockServer();
        render(<ArtifactImportPanel userId="u1" category="Research" onUploaded={jest.fn()} />);
        fireEvent.change(screen.getByLabelText("Artifact code"), { target: { value: "# Notes" } });
        fireEvent.change(screen.getByLabelText("Link to the original (optional)"), {
            target: { value: "javascript:alert(1)" },
        });
        expect(screen.getByText("Use an http(s) link.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Add as source" })).toBeDisabled();
    });

    it("brings over artifacts imported before, then archives the old copies", async () => {
        const calls = mockServer([{ id: 7, title: "Old flow", artifactType: "mermaid" }]);
        const onUploaded = jest.fn();
        render(<ArtifactImportPanel userId="u1" category="Unfiled" onUploaded={onUploaded} />);

        fireEvent.click(await screen.findByRole("button", { name: "Add it as a source" }));
        await waitFor(() => expect(onUploaded).toHaveBeenCalled());

        const registered = calls.find(call => call.url === "/api/uploadDocument")!;
        expect(registered.body).toMatchObject({
            documentName: "Old flow",
            artifact: { artifactType: "mermaid" },
        });
        expect(
            calls.some(call => call.url === "/api/artifacts/7" && call.method === "DELETE")
        ).toBe(true);
        // Archived only after its source exists.
        const order = calls.map(call => `${call.method} ${call.url}`);
        expect(order.indexOf("DELETE /api/artifacts/7")).toBeGreaterThan(
            order.indexOf("POST /api/uploadDocument")
        );
    });
});
