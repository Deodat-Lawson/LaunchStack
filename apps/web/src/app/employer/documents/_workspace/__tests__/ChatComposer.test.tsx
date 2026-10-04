/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Composer, type ComposerProps } from "../ChatComposer";
import {
    COMPOSER_MAX_CHARACTERS,
    LARGE_PASTE_BYTES,
    caretAtVisualBoundary,
    composerDocumentWithoutContext,
    isComposerDraft,
    listContinuation,
    modelSearchMatches,
    shouldAttachPaste,
} from "../composerState";
import type { ComposerSend } from "../types";
import { heicTo } from "heic-to/csp";
import { composerJsonToMarkdown } from "../RichChatEditor";

jest.mock("heic-to/csp", () => ({ heicTo: jest.fn() }));
const convertHeic = jest.mocked(heicTo);

jest.mock("../AskPanel", () => ({
    SourceChip: ({ source, onRemove }: { source: { title: string }; onRemove?: () => void }) => (
        <span>
            {source.title}
            <button onClick={onRemove}>Remove source {source.title}</button>
        </span>
    ),
}));
jest.mock("../../hooks/useChatRoutes", () => ({
    useChatRoutes: () => ({
        loading: false,
        visionEnabled: true,
        reasoningEnabled: true,
        config: {
            routes: {
                default: { available: true, model: "Default model" },
                fast: { available: true, model: "Speed model" },
                reasoning: {
                    available: true,
                    model: "Thinking model",
                    reasoning: { controllable: true, mode: "effort", efforts: ["low", "high"] },
                },
                vision: {
                    available: true,
                    model: "Image model",
                    vision: {
                        supported: true,
                        mimeTypes: ["image/png", "image/jpeg"],
                        maxImages: 2,
                    },
                },
            },
        },
    }),
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

class UploadRequest {
    static requests: UploadRequest[] = [];
    status = 0;
    responseText = "";
    upload: {
        onprogress?: (event: { lengthComputable: boolean; loaded: number; total: number }) => void;
    } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    open = jest.fn();
    send = jest.fn(() => {
        UploadRequest.requests.push(this);
    });
    abort = jest.fn(() => this.onabort?.());
    complete(status = 200) {
        this.status = status;
        this.responseText =
            status === 200
                ? JSON.stringify({
                      objectKey: `file-${UploadRequest.requests.indexOf(this)}`,
                      url: "/file.txt",
                  })
                : JSON.stringify({ error: "Storage is offline" });
        this.onload?.();
    }
}
const originalRequest = window.XMLHttpRequest;
const originalFetch = globalThis.fetch;
const restoredFile = {
    id: "restored-file",
    name: "saved.pdf",
    mimeType: "application/pdf",
    size: 50 * 1024 * 1024,
    url: "/saved.pdf",
    kind: "text" as const,
};
function persistAttachedDraft(key: string) {
    localStorage.setItem(
        `launchstack:composer:${key}`,
        JSON.stringify({
            text: "Keep my attachment draft",
            attachments: [restoredFile],
            refs: [],
            webSearch: false,
            thinking: false,
            agentKey: null,
        })
    );
}

function mount(overrides: Partial<ComposerProps> = {}) {
    const onSend = jest.fn<void, [ComposerSend]>();
    const props: ComposerProps = {
        sources: [],
        selected: [],
        setSelected: jest.fn(),
        onSend,
        webSearch: false,
        onToggleWebSearch: jest.fn(),
        thinking: false,
        onToggleThinking: jest.fn(),
        agents: [],
        agentKey: null,
        onChangeAgent: jest.fn(),
        ...overrides,
    };
    const result = render(<Composer {...props} />);
    return {
        ...result,
        props,
        onSend,
        box: screen.getByRole<HTMLTextAreaElement>("textbox", { name: "Chat message" }),
    };
}
function attach(file = new File(["hello"], "notes.txt", { type: "text/plain" })) {
    fireEvent.change(screen.getByLabelText("Attach files"), { target: { files: [file] } });
}

beforeEach(() => {
    localStorage.clear();
    UploadRequest.requests = [];
    convertHeic.mockReset();
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Unconfigured test network"));
    window.XMLHttpRequest = UploadRequest as unknown as typeof XMLHttpRequest;
});
afterEach(() => {
    globalThis.fetch = originalFetch;
});
afterAll(() => {
    window.XMLHttpRequest = originalRequest;
});

describe("Composer draft and keyboard behavior", () => {
    it("retains a missing selected source as an unavailable chip and blocks sending until removed", () => {
        const setSelected = jest.fn();
        const { box, props, onSend, rerender } = mount({
            selected: ["deleted-source"],
            setSelected,
        });
        fireEvent.change(box, { target: { value: "Use my selected context" } });
        expect(screen.getByText("Unavailable source · deleted-source")).toBeInTheDocument();
        expect(screen.getByText(/Some selected context is unavailable/)).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).not.toHaveBeenCalled();
        fireEvent.click(
            screen.getByRole("button", { name: "Remove unavailable source deleted-source" })
        );
        expect(setSelected).toHaveBeenCalledWith(expect.any(Function));
        rerender(<Composer {...props} selected={[]} />);
        expect(screen.queryByText("Unavailable source · deleted-source")).not.toBeInTheDocument();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ refs: [], text: "Use my selected context" })
        );
    });

    it("persists a draft in its user/workspace/thread scope and clears it after send", async () => {
        const first = mount({ draftKey: "user:workspace:thread" });
        fireEvent.change(first.box, { target: { value: "Keep this draft" } });
        expect(
            JSON.parse(localStorage.getItem("launchstack:composer:user:workspace:thread")!).text
        ).toBe("Keep this draft");
        first.unmount();
        const second = mount({ draftKey: "user:workspace:thread" });
        await waitFor(() => expect(second.box).toHaveValue("Keep this draft"));
        await userEvent.click(screen.getByRole("button", { name: "Send message" }));
        expect(second.onSend).toHaveBeenCalledWith(
            expect.objectContaining({ text: "Keep this draft" })
        );
        expect(second.box).toHaveValue("");
        expect(
            JSON.parse(localStorage.getItem("launchstack:composer:user:workspace:thread")!).text
        ).toBe("");
    });

    it("switches thread scope without carrying the previous draft", () => {
        const first = mount({ draftKey: "account:workspace:first" });
        fireEvent.change(first.box, { target: { value: "First draft" } });
        first.rerender(<Composer {...first.props} draftKey="account:workspace:second" />);
        expect(first.box).toHaveValue("");
        expect(
            JSON.parse(localStorage.getItem("launchstack:composer:account:workspace:first")!).text
        ).toBe("First draft");
    });

    it("retains an over-limit draft and blocks submission", () => {
        const { box, onSend } = mount();
        const text = "x".repeat(COMPOSER_MAX_CHARACTERS + 1);
        fireEvent.change(box, { target: { value: text } });
        expect(box).toHaveValue(text);
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).not.toHaveBeenCalled();
        expect(screen.getByRole("alert")).toHaveTextContent("120,001 / 120,000");
    });

    it("ignores Enter and recall during IME composition", () => {
        const { box, onSend } = mount({ promptHistory: ["Prior prompt"] });
        fireEvent.change(box, { target: { value: "入力" } });
        fireEvent.keyDown(box, { key: "Enter", isComposing: true });
        expect(onSend).not.toHaveBeenCalled();
        expect(box).toHaveValue("入力");
    });

    it("recalls loaded prompts, walks both ways, and stops after editing", async () => {
        const { box } = mount({ promptHistory: ["First", "Second"] });
        fireEvent.keyDown(box, { key: "ArrowUp" });
        expect(box).toHaveValue("Second");
        box.setSelectionRange(0, 0);
        fireEvent.keyDown(box, { key: "ArrowUp" });
        expect(box).toHaveValue("First");
        box.setSelectionRange(5, 5);
        fireEvent.keyDown(box, { key: "ArrowDown" });
        expect(box).toHaveValue("Second");
        box.setSelectionRange(6, 6);
        fireEvent.keyDown(box, { key: "ArrowDown" });
        expect(box).toHaveValue("");
        fireEvent.change(box, { target: { value: "Normal draft" } });
        box.setSelectionRange(0, 0);
        const event = new KeyboardEvent("keydown", {
            key: "ArrowUp",
            bubbles: true,
            cancelable: true,
        });
        act(() => {
            box.dispatchEvent(event);
        });
        expect(event.defaultPrevented).toBe(false);
        expect(box).toHaveValue("Normal draft");
    });

    it("does not recall with an attached file", () => {
        const { box } = mount({ promptHistory: ["Prior prompt"] });
        attach();
        fireEvent.keyDown(box, { key: "ArrowUp" });
        expect(box).toHaveValue("");
    });

    it("saves and restores a prompt with Cmd/Ctrl+S", () => {
        const { box } = mount({ draftKey: "scope" });
        fireEvent.change(box, { target: { value: "A prompt to stash" } });
        fireEvent.keyDown(box, { key: "s", ctrlKey: true });
        expect(box).toHaveValue("");
        fireEvent.keyDown(box, { key: "s", ctrlKey: true });
        expect(box).toHaveValue("A prompt to stash");
    });

    it("opens a picker for multiple stashed prompts", () => {
        const { box } = mount();
        for (const value of ["One", "Two"]) {
            fireEvent.change(box, { target: { value } });
            fireEvent.keyDown(box, { key: "s", metaKey: true });
        }
        fireEvent.keyDown(box, { key: "s", metaKey: true });
        expect(screen.getByRole("dialog")).toHaveTextContent("Saved prompts");
        fireEvent.click(screen.getByText("One"));
        expect(box).toHaveValue("One");
    });

    it("continues to send if local storage is unavailable", () => {
        const spy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("Quota");
        });
        const { box, onSend } = mount({ draftKey: "blocked" });
        fireEvent.change(box, { target: { value: "Still usable" } });
        expect(screen.getByRole("alert")).toHaveTextContent("Draft storage is unavailable");
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalled();
        spy.mockRestore();
    });

    it("supports modifier Enter settings and preserves ordinary Enter", async () => {
        const user = userEvent.setup();
        const { box, onSend } = mount();
        await user.click(screen.getByRole("button", { name: "Composer settings" }));
        await user.click(screen.getByRole("button", { name: "⌘/Ctrl+Enter" }));
        fireEvent.change(box, { target: { value: "Multiline draft" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).not.toHaveBeenCalled();
        fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
        expect(onSend).toHaveBeenCalled();
    });

    it("defaults mobile Enter to newline while honoring an explicit send preference", () => {
        const original = window.matchMedia;
        window.matchMedia = jest.fn().mockReturnValue({ matches: true });
        try {
            const { box, onSend } = mount();
            fireEvent.change(box, { target: { value: "Mobile draft" } });
            fireEvent.keyDown(box, { key: "Enter" });
            expect(onSend).not.toHaveBeenCalled();
            fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
            expect(onSend).toHaveBeenCalledWith(expect.objectContaining({ text: "Mobile draft" }));
        } finally {
            window.matchMedia = original;
        }
    });
});

describe("Composer uploads and completion", () => {
    it("checks restored files with HEAD and retains a named unavailable file until removed", async () => {
        const readBody = jest.fn();
        const fetchFile = jest.fn().mockResolvedValue({ status: 404, ok: false, text: readBody });
        globalThis.fetch = fetchFile;
        persistAttachedDraft("missing-file");
        const { box, onSend } = mount({ draftKey: "missing-file" });
        await screen.findByText("Unavailable");
        expect(screen.getByRole("button", { name: "Reattach saved.pdf" })).toBeInTheDocument();
        expect(fetchFile).toHaveBeenCalledWith(
            "/saved.pdf",
            expect.objectContaining({ method: "HEAD", credentials: "same-origin" })
        );
        expect(readBody).not.toHaveBeenCalled();
        expect(box).toHaveValue("Keep my attachment draft");
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole("button", { name: "Remove saved.pdf" }));
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ text: "Keep my attachment draft", attachments: [] })
        );
    });

    it("keeps an unavailable original during a failed reattachment and replaces it only after success", async () => {
        globalThis.fetch = jest.fn().mockResolvedValue({ status: 410, ok: false });
        persistAttachedDraft("reattach-file");
        const { box, onSend } = mount({ draftKey: "reattach-file" });
        await screen.findByText("Unavailable");
        fireEvent.click(screen.getByRole("button", { name: "Reattach saved.pdf" }));
        fireEvent.change(screen.getByLabelText("Reattach unavailable file"), {
            target: { files: [new File(["new notes"], "replacement.txt", { type: "text/plain" })] },
        });
        act(() => UploadRequest.requests[0]!.complete(503));
        expect(screen.getByText("saved.pdf")).toBeInTheDocument();
        expect(box).toHaveValue("Keep my attachment draft");
        fireEvent.click(screen.getByRole("button", { name: "Retry upload replacement.txt" }));
        act(() => UploadRequest.requests[1]!.complete());
        expect(screen.queryByText("saved.pdf")).not.toBeInTheDocument();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({
                attachments: [expect.objectContaining({ name: "replacement.txt" })],
            })
        );
    });

    it.each([405, 403])(
        "leaves unsupported or inaccessible HEAD status %s unknown for send validation",
        async status => {
            globalThis.fetch = jest.fn().mockResolvedValue({ status, ok: false });
            persistAttachedDraft(`head-${status}`);
            const { box, onSend } = mount({ draftKey: `head-${status}` });
            await act(async () => {});
            expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
            fireEvent.keyDown(box, { key: "Enter" });
            expect(onSend).toHaveBeenCalledWith(
                expect.objectContaining({ attachments: [restoredFile] })
            );
        }
    );

    it("ignores a late availability result after switching draft scopes", async () => {
        let complete!: (value: { status: number; ok: boolean }) => void;
        globalThis.fetch = jest.fn(
            () =>
                new Promise<Response>(resolve => {
                    complete = value => resolve(value as Response);
                })
        );
        persistAttachedDraft("old-file-scope");
        const { box, props, rerender } = mount({ draftKey: "old-file-scope" });
        rerender(<Composer {...props} draftKey="new-file-scope" />);
        fireEvent.change(box, { target: { value: "New scope draft" } });
        await act(async () => {
            complete({ status: 404, ok: false });
        });
        expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
        expect(box).toHaveValue("New scope draft");
        expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    });

    it("keeps CORS or network HEAD failures unknown instead of declaring a permanent file missing", async () => {
        globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Failed to fetch: CORS"));
        persistAttachedDraft("cors-file");
        const { box, onSend } = mount({ draftKey: "cors-file" });
        await act(async () => {});
        expect(screen.queryByText("Unavailable")).not.toBeInTheDocument();
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ attachments: [restoredFile] })
        );
    });

    it("uploads JPEG metadata after converting a HEIC with a missing MIME type", async () => {
        convertHeic.mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" }));
        const { box, onSend } = mount();
        attach(new File(["heic"], "phone.heic"));
        await waitFor(() => expect(UploadRequest.requests).toHaveLength(1));
        act(() => UploadRequest.requests[0]!.complete());
        fireEvent.change(box, { target: { value: "Describe this" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({
                attachments: [
                    expect.objectContaining({
                        name: "phone.jpg",
                        mimeType: "image/jpeg",
                        kind: "image",
                    }),
                ],
                modelRoute: "vision",
            })
        );
    });

    it("keeps an invalid HEIC out of storage and reports how to fix it", async () => {
        convertHeic.mockRejectedValue(new Error("Invalid HEIC"));
        mount();
        attach(new File(["bad"], "broken.heic"));
        await screen.findByText(/could not be converted from HEIC/);
        expect(UploadRequest.requests).toHaveLength(0);
    });

    it("retains concurrent conversion batches and lets preparation be canceled", async () => {
        const resolve: ((value: Blob) => void)[] = [];
        convertHeic.mockImplementation(
            () =>
                new Promise<Blob>(done => {
                    resolve.push(done);
                })
        );
        mount();
        attach(new File(["first"], "first.heic"));
        attach(new File(["second"], "second.heic"));
        await waitFor(() => expect(resolve).toHaveLength(2));
        await act(async () => {
            resolve[0]!(new Blob(["jpeg"], { type: "image/jpeg" }));
        });
        expect(UploadRequest.requests).toHaveLength(1);
        fireEvent.click(screen.getByRole("button", { name: "Cancel image preparation" }));
        await act(async () => {
            resolve[1]!(new Blob(["jpeg"], { type: "image/jpeg" }));
        });
        expect(UploadRequest.requests).toHaveLength(1);
        expect(screen.getByText("first.jpg")).toBeInTheDocument();
    });

    it("reserves conversion slots before asynchronous work so another batch cannot exceed 100", async () => {
        convertHeic.mockImplementation(() => new Promise<Blob>(() => {}));
        mount();
        fireEvent.change(screen.getByLabelText("Attach files"), {
            target: {
                files: Array.from(
                    { length: 99 },
                    (_, index) => new File(["heic"], `photo-${index}.heic`)
                ),
            },
        });
        fireEvent.change(screen.getByLabelText("Attach files"), {
            target: { files: [new File(["a"], "extra-a.txt"), new File(["b"], "extra-b.txt")] },
        });
        expect(screen.getByRole("alert")).toHaveTextContent("Attach up to 100 files");
        expect(UploadRequest.requests).toHaveLength(0);
        fireEvent.click(screen.getByRole("button", { name: "Cancel image preparation" }));
        await act(async () => {});
    });

    it("shows upload progress, blocks send, and sends completed metadata", () => {
        const { box, onSend } = mount();
        fireEvent.change(box, { target: { value: "Read my file" } });
        attach();
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        act(() =>
            UploadRequest.requests[0]!.upload.onprogress?.({
                lengthComputable: true,
                loaded: 4,
                total: 10,
            })
        );
        expect(screen.getByRole("progressbar", { name: "Uploading notes.txt" })).toHaveAttribute(
            "value",
            "40"
        );
        act(() => UploadRequest.requests[0]!.complete());
        fireEvent.click(screen.getByRole("button", { name: "Send message" }));
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({
                attachments: [expect.objectContaining({ name: "notes.txt", url: "/file.txt" })],
            })
        );
    });

    it("keeps failed uploads visible until retry succeeds", () => {
        mount();
        attach();
        act(() => UploadRequest.requests[0]!.complete(500));
        expect(screen.getByRole("alert")).toHaveTextContent("Storage is offline");
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Retry upload notes.txt" }));
        act(() => UploadRequest.requests[1]!.complete());
        expect(screen.getByRole("button", { name: "Preview notes.txt" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    });

    it("cancels and removes an in-flight upload", () => {
        mount();
        attach();
        fireEvent.click(screen.getByRole("button", { name: "Cancel upload notes.txt" }));
        expect(screen.getByRole("alert")).toHaveTextContent("Upload canceled");
        fireEvent.click(screen.getByRole("button", { name: "Remove upload notes.txt" }));
        expect(screen.queryByText("notes.txt")).not.toBeInTheDocument();
    });

    it("turns a large paste into a text attachment and leaves the draft intact", () => {
        const { box } = mount();
        fireEvent.change(box, { target: { value: "My question" } });
        fireEvent.paste(box, {
            clipboardData: { files: [], getData: () => "x".repeat(LARGE_PASTE_BYTES) },
        });
        expect(box).toHaveValue("My question");
        expect(UploadRequest.requests).toHaveLength(1);
        expect(screen.getByText(/pasted-text-/)).toBeInTheDocument();
    });

    it("honors Shift-paste bypass", () => {
        const { box } = mount();
        fireEvent.keyDown(box, { key: "v", ctrlKey: true, shiftKey: true });
        fireEvent.paste(box, {
            clipboardData: { files: [], getData: () => "x".repeat(LARGE_PASTE_BYTES) },
        });
        expect(UploadRequest.requests).toHaveLength(0);
    });

    it("accepts clipboard images and drag-and-drop documents", () => {
        const { box } = mount();
        fireEvent.paste(box, {
            clipboardData: {
                files: [new File(["png"], "image.png", { type: "image/png" })],
                getData: () => "",
            },
        });
        fireEvent.drop(screen.getByTestId("chat-composer"), {
            dataTransfer: { files: [new File(["text"], "dropped.md", { type: "text/markdown" })] },
        });
        expect(UploadRequest.requests).toHaveLength(2);
    });

    it("enforces count, file size, and configured image formats", async () => {
        mount();
        fireEvent.change(screen.getByLabelText("Attach files"), {
            target: {
                files: Array.from(
                    { length: 101 },
                    (_, index) => new File([""], `${index}.txt`, { type: "text/plain" })
                ),
            },
        });
        expect(screen.getByRole("alert")).toHaveTextContent("100 files");
        const oversized = new File([""], "large.png", { type: "image/png" });
        Object.defineProperty(oversized, "size", { value: 11 * 1024 * 1024 });
        attach(oversized);
        await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("10 MiB"));
        attach(new File(["gif"], "photo.gif", { type: "image/gif" }));
        expect(screen.getByRole("alert")).toHaveTextContent(
            "not supported by the configured image model"
        );
        expect(UploadRequest.requests).toHaveLength(0);
    });

    it("runs slash commands without sending literal commands", () => {
        const { box, onSend } = mount();
        fireEvent.change(box, { target: { value: "/plan" } });
        expect(screen.getByRole("listbox", { name: "Commands" })).toHaveTextContent(
            "Plan before answering"
        );
        fireEvent.keyDown(box, { key: "Enter" });
        expect(box).toHaveValue("");
        fireEvent.change(box, { target: { value: "Create a plan" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ text: "Create a plan", chatMode: "plan" })
        );
    });

    it("chooses configured models and only supported reasoning efforts", async () => {
        const user = userEvent.setup();
        const { box, onSend } = mount();
        await user.click(screen.getByRole("button", { name: "Choose model" }));
        await user.type(screen.getByRole("textbox", { name: "Search models" }), "Thinking");
        await user.click(screen.getByRole("option", { name: /Thinking model/ }));
        await user.click(screen.getByRole("button", { name: "Choose model" }));
        await user.selectOptions(
            screen.getByRole("combobox", { name: "Reasoning effort" }),
            "high"
        );
        expect(
            within(screen.getByRole("combobox", { name: "Reasoning effort" })).getAllByRole(
                "option"
            )
        ).toHaveLength(3);
        fireEvent.change(box, { target: { value: "Think carefully" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ modelRoute: "reasoning", reasoningEffort: "high" })
        );
    });

    it("queues during an active turn and offers Stop for an empty draft", () => {
        const onStop = jest.fn();
        const { box, onSend } = mount({ active: true, onStop });
        fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
        expect(onStop).toHaveBeenCalled();
        fireEvent.change(box, { target: { value: "A follow-up" } });
        fireEvent.click(screen.getByRole("button", { name: "Queue message" }));
        expect(onSend).toHaveBeenCalled();
    });

    it("dispatches comparison model routes and conversation references", () => {
        const { box, onSend } = mount({
            threadContextOptions: [{ id: "thread-1", title: "Revenue planning" }],
        });
        fireEvent.change(box, { target: { value: "@Revenue" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(box.value).toContain("Revenue planning");
        fireEvent.click(screen.getByRole("button", { name: "Choose model" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Compare default model" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "Compare fast model" }));
        fireEvent.change(box, { target: { value: "Compare this question" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(onSend).toHaveBeenCalledWith(
            expect.objectContaining({ modelRoutes: ["default", "fast"], threadRefs: ["thread-1"] })
        );
    });

    it("restores an asynchronously rejected send", async () => {
        let acknowledge!: (value: boolean) => void;
        const onSend = jest.fn(
            () =>
                new Promise<boolean>(resolve => {
                    acknowledge = resolve;
                })
        );
        const { box } = mount({ onSend });
        fireEvent.change(box, { target: { value: "Do not lose this question" } });
        fireEvent.keyDown(box, { key: "Enter" });
        expect(box).toHaveValue("");
        await act(async () => {
            acknowledge(false);
        });
        expect(box).toHaveValue("Do not lose this question");
        expect(screen.getByRole("alert")).toHaveTextContent("draft has been restored");
    });

    it("preserves newer typing when an earlier send fails and offers the saved failed prompt", async () => {
        let acknowledge!: (value: boolean) => void;
        const { box } = mount({
            onSend: () =>
                new Promise<boolean>(resolve => {
                    acknowledge = resolve;
                }),
        });
        fireEvent.change(box, { target: { value: "Original failed question" } });
        fireEvent.keyDown(box, { key: "Enter" });
        fireEvent.change(box, { target: { value: "Newer draft" } });
        await act(async () => {
            acknowledge(false);
        });
        expect(box).toHaveValue("Newer draft");
        fireEvent.click(screen.getByRole("button", { name: "Restore failed prompt" }));
        fireEvent.click(screen.getByText("Original failed question"));
        expect(box).toHaveValue("Original failed question");
    });

    it("suspends an unsent draft while editing a queued message and restores it on cancel", () => {
        const { box, props, rerender } = mount();
        fireEvent.change(box, { target: { value: "Unsent draft" } });
        const seed = {
            text: "Queued question",
            mode: "replace" as const,
            nonce: 1,
            attachments: [],
        };
        rerender(<Composer {...props} editingQueued seed={seed} />);
        expect(box).toHaveValue("Queued question");
        fireEvent.change(box, { target: { value: "Edited queued question" } });
        rerender(<Composer {...props} editingQueued={false} seed={seed} />);
        expect(box).toHaveValue("Unsent draft");
    });

    it("restores explicitly seeded send controls while quote seeds leave them unchanged", () => {
        const onToggleWebSearch = jest.fn();
        const onToggleThinking = jest.fn();
        const onChangeAgent = jest.fn();
        const { props, rerender } = mount({ onToggleWebSearch, onToggleThinking, onChangeAgent });
        rerender(
            <Composer
                {...props}
                seed={{
                    nonce: 903,
                    text: "Queued prompt",
                    mode: "replace",
                    webSearch: true,
                    thinking: true,
                    agentKey: "research",
                }}
            />
        );
        expect(onToggleWebSearch).toHaveBeenCalledTimes(1);
        expect(onToggleThinking).toHaveBeenCalledTimes(1);
        expect(onChangeAgent).toHaveBeenCalledWith("research");
        rerender(
            <Composer {...props} seed={{ nonce: 904, text: "> Selected quote", mode: "append" }} />
        );
        expect(onToggleWebSearch).toHaveBeenCalledTimes(1);
        expect(onToggleThinking).toHaveBeenCalledTimes(1);
        expect(onChangeAgent).toHaveBeenCalledTimes(1);
    });

    it("restores the unsent draft after remount without replaying a consumed queue-edit seed", () => {
        const first = mount({ draftKey: "queue-remount" });
        fireEvent.change(first.box, { target: { value: "Original unsent draft" } });
        const seed = {
            text: "Queued question",
            mode: "replace" as const,
            nonce: 431,
            attachments: [],
        };
        first.rerender(<Composer {...first.props} editingQueued seed={seed} />);
        first.unmount();
        const restored = mount({ draftKey: "queue-remount", seed, editingQueued: false });
        expect(restored.box).toHaveValue("Original unsent draft");
    });

    it("detaches edits from a missing queued row without losing the independent unsent draft", () => {
        const cancel = jest.fn();
        const { box, props, rerender } = mount({
            draftKey: "missing-queue",
            onCancelQueueEdit: cancel,
        });
        fireEvent.change(box, { target: { value: "Independent draft" } });
        const seed = { text: "Queued question", mode: "replace" as const, nonce: 821 };
        rerender(<Composer {...props} editingQueued seed={seed} />);
        fireEvent.change(box, { target: { value: "Edited queued question" } });
        rerender(<Composer {...props} editingQueued queuedEditUnavailable seed={seed} />);
        expect(screen.getByRole("button", { name: "Save queued message" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Use edits in a new message" }));
        expect(cancel).toHaveBeenCalled();
        rerender(<Composer {...props} editingQueued={false} seed={seed} />);
        expect(box).toHaveValue("Edited queued question");
        expect(
            JSON.parse(localStorage.getItem("launchstack:composer:missing-queue:stashes")!)[0].text
        ).toBe("Independent draft");
        expect(JSON.parse(localStorage.getItem("launchstack:composer:missing-queue")!).text).toBe(
            "Edited queued question"
        );
    });

    it("shows safe image thumbnails in saved prompts and preserves the current model when restoring", async () => {
        const draft = {
            attachments: [],
            refs: [],
            webSearch: false,
            thinking: false,
            agentKey: null,
        };
        localStorage.setItem(
            "launchstack:composer:thumbnails:stashes",
            JSON.stringify([
                {
                    ...draft,
                    id: "one",
                    savedAt: Date.now(),
                    text: "With an image",
                    modelRoute: "fast",
                    attachments: [
                        {
                            id: "image",
                            name: "saved.png",
                            url: "/saved.png",
                            mimeType: "image/png",
                            size: 4,
                            kind: "image",
                        },
                    ],
                },
                { ...draft, id: "two", savedAt: Date.now(), text: "Other prompt" },
            ])
        );
        const { box } = mount({ draftKey: "thumbnails" });
        fireEvent.click(screen.getByRole("button", { name: "Restore saved prompts" }));
        expect(screen.getByRole("img", { name: "saved.png thumbnail" })).toHaveAttribute(
            "src",
            "/saved.png"
        );
        fireEvent.click(screen.getByText("With an image"));
        await act(async () => {});
        expect(box).toHaveValue("With an image");
        expect(screen.getByRole("button", { name: "Choose model" })).toHaveTextContent(
            "Default model"
        );
    });

    it("retains an actionable marker when an upload was interrupted by reload", () => {
        const first = mount({ draftKey: "reload" });
        attach();
        first.unmount();
        mount({ draftKey: "reload" });
        expect(screen.getByText(/upload did not finish/)).toHaveTextContent("notes.txt");
        expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
        fireEvent.click(screen.getByRole("button", { name: "Remove missing file notes.txt" }));
        expect(screen.queryByText(/upload did not finish/)).not.toBeInTheDocument();
    });

    it("keeps the draft intact when sending the oldest queued prompt via shortcut", () => {
        const sendOldest = jest.fn();
        const { box, onSend } = mount({
            active: true,
            queuedCount: 2,
            onQueueSendOldest: sendOldest,
        });
        fireEvent.change(box, { target: { value: "Current draft" } });
        fireEvent.keyDown(box, { key: "Enter", ctrlKey: true, shiftKey: true });
        expect(sendOldest).toHaveBeenCalled();
        expect(onSend).not.toHaveBeenCalled();
        expect(box).toHaveValue("Current draft");
    });

    it("retries only failed routes after a partially successful comparison", async () => {
        const { box, props, rerender } = mount({
            onSend: () => Promise.resolve({ success: false, failedModelRoutes: ["fast"] }),
        });
        fireEvent.change(box, { target: { value: "Comparison question" } });
        fireEvent.keyDown(box, { key: "Enter" });
        await waitFor(() => expect(box).toHaveValue("Comparison question"));
        expect(screen.getByRole("button", { name: "Choose model" })).toHaveTextContent(
            "Speed model"
        );
        const retry = jest.fn<boolean, [ComposerSend]>(() => true);
        rerender(<Composer {...props} onSend={retry} />);
        fireEvent.keyDown(box, { key: "Enter" });
        expect(retry).toHaveBeenCalledWith(
            expect.objectContaining({ modelRoute: "fast", text: "Comparison question" })
        );
        expect(retry.mock.calls[0]?.[0]).not.toHaveProperty("modelRoutes");
    });

    it("does not overwrite a newer origin draft when a request fails after navigation", async () => {
        let acknowledge!: (value: boolean) => void;
        const { box, props, rerender } = mount({
            draftKey: "origin",
            onSend: () =>
                new Promise<boolean>(resolve => {
                    acknowledge = resolve;
                }),
        });
        fireEvent.change(box, { target: { value: "Failed original" } });
        fireEvent.keyDown(box, { key: "Enter" });
        rerender(<Composer {...props} draftKey="other" />);
        localStorage.setItem(
            "launchstack:composer:origin",
            JSON.stringify({
                text: "Newer origin draft",
                attachments: [],
                refs: [],
                webSearch: false,
                thinking: false,
                agentKey: null,
            })
        );
        await act(async () => {
            acknowledge(false);
        });
        expect(JSON.parse(localStorage.getItem("launchstack:composer:origin")!).text).toBe(
            "Newer origin draft"
        );
        expect(
            JSON.parse(localStorage.getItem("launchstack:composer:origin:stashes")!)[0].text
        ).toBe("Failed original");
    });
});

describe("Composer utility boundaries", () => {
    it("derives rich recall text without quote, source, conversation or attachment chip context", () => {
        const document = {
            type: "doc",
            content: [
                {
                    type: "paragraph",
                    content: [
                        { type: "text", text: "Typed prompt " },
                        ...["quote", "source", "thread", "attachment"].map(kind => ({
                            type: "composerContext",
                            attrs: {
                                context: {
                                    id: kind,
                                    kind,
                                    label: "Machine context",
                                    markdown: "Context",
                                    quote: "Quoted words",
                                },
                            },
                        })),
                        { type: "text", text: "finish" },
                    ],
                },
            ],
        };
        expect(composerJsonToMarkdown(composerDocumentWithoutContext(document))).toBe(
            "Typed prompt finish"
        );
    });

    it("measures UTF-8 byte size and projected character count", () => {
        expect(shouldAttachPaste("x".repeat(LARGE_PASTE_BYTES - 1), "")).toBe(false);
        expect(shouldAttachPaste("é".repeat(LARGE_PASTE_BYTES / 2), "")).toBe(true);
        expect(shouldAttachPaste("ab", "x".repeat(COMPOSER_MAX_CHARACTERS - 1))).toBe(true);
        expect(shouldAttachPaste("ab", "x".repeat(COMPOSER_MAX_CHARACTERS - 1), 2)).toBe(false);
    });
    it("rejects malformed persisted drafts", () => {
        expect(
            isComposerDraft({
                text: "text",
                attachments: [{}],
                refs: [],
                webSearch: false,
                thinking: false,
                agentKey: null,
            })
        ).toBe(false);
        expect(
            isComposerDraft({
                text: "text",
                attachments: [],
                refs: [],
                webSearch: false,
                thinking: false,
                agentKey: null,
            })
        ).toBe(true);
    });
    it("never takes over an ordinary caret inside hidden-layout text", () => {
        const area = document.createElement("textarea");
        area.value = "normal text";
        area.setSelectionRange(3, 3);
        expect(caretAtVisualBoundary(area, "up")).toBe(false);
        expect(caretAtVisualBoundary(area, "down")).toBe(false);
    });
    it("supports tokenized fuzzy model search and list/task continuation", () => {
        expect(modelSearchMatches("Speed model fast", "spd mod")).toBe(true);
        expect(modelSearchMatches("Speed model fast", "unknown")).toBe(false);
        expect(listContinuation("1. First", 8)).toEqual({ start: 8, end: 8, replacement: "\n2. " });
        expect(listContinuation("- [x] Done", 10)).toEqual({
            start: 10,
            end: 10,
            replacement: "\n- [ ] ",
        });
        expect(listContinuation("- ", 2)).toEqual({ start: 0, end: 2, replacement: "" });
    });
});
