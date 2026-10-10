/** @jest-environment jsdom */

import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

import { MediaViewer } from "../media/MediaViewer";
import type { DocumentType } from "../../types";
import type { MediaPreview } from "~/lib/media-document";

/**
 * The media viewer: whatever `/api/documents/[id]/media` says to play, with
 * the transcript under it — lines that play from their moment, the line under
 * the playhead marked, and a citation that cues the player to what it cites.
 */

const fetchMock = jest.fn();
const playMock = jest.fn();
const pauseMock = jest.fn();

const DOC: DocumentType = {
    id: 3,
    title: "standup.mp4 (Transcription)",
    category: "Media",
    url: "/api/files/3",
    mimeType: "text/plain",
};

const SEGMENTS = [
    { start: 0, end: 4, text: "Welcome to the weekly product standup." },
    { start: 4, end: 9.5, text: "The billing migration is blocked on the tax provider." },
    { start: 9.5, end: 14, text: "We demo the new search on Friday." },
];

function preview(overrides: Partial<MediaPreview> = {}): MediaPreview {
    return {
        documentId: 3,
        title: "standup.mp4",
        kind: "video",
        playback: {
            type: "file",
            documentId: 1,
            url: "/api/documents/1/content",
            mimeType: "video/mp4",
        },
        transcript: {
            documentId: 3,
            title: "standup.mp4 (Transcription)",
            language: "en",
            segments: SEGMENTS,
        },
        durationSeconds: null,
        ...overrides,
    };
}

/** jsdom has no `Response`; the viewer only reads these members. */
function reply(status: number, body: string) {
    return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(JSON.parse(body) as unknown),
        text: () => Promise.resolve(body),
    });
}

function respondWith(body: unknown, init: { status?: number } = {}) {
    fetchMock.mockImplementation((url: string) => {
        if (url.endsWith("/media")) return reply(init.status ?? 200, JSON.stringify(body));
        if (url.endsWith("/content")) {
            return reply(200, "Welcome to the weekly product standup. Billing is blocked.");
        }
        return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
}

function windowOf(frame: HTMLIFrameElement): Window {
    if (!frame.contentWindow) throw new Error("the frame has no window");
    return frame.contentWindow;
}

function video(): HTMLVideoElement {
    const el = screen.getByTestId("file-player").querySelector("video");
    if (!el) throw new Error("no media element");
    return el;
}

beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
    // jsdom has no media pipeline and no element scrolling.
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
        configurable: true,
        value: playMock,
    });
    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
        configurable: true,
        value: pauseMock,
    });
    Element.prototype.scrollTo = jest.fn();
    (global as { ResizeObserver?: unknown }).ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    };
});

beforeEach(() => {
    fetchMock.mockReset();
    playMock.mockReset().mockResolvedValue(undefined);
    pauseMock.mockReset();
});

describe("MediaViewer — a stored recording", () => {
    it("plays the recording from its ranged, same-origin URL", async () => {
        respondWith(preview());

        render(<MediaViewer document={DOC} />);

        await screen.findByTestId("file-player");
        expect(fetchMock).toHaveBeenCalledWith("/api/documents/3/media");
        expect(video()).toHaveAttribute("src", "/api/documents/1/content");
        expect(video()).toHaveAttribute("controls");
        expect(screen.getByTestId("file-player")).toHaveAttribute("data-kind", "video");
    });

    it("lists the timestamped transcript and plays from a clicked line", async () => {
        respondWith(preview());
        render(<MediaViewer document={DOC} />);

        const line = await screen.findByRole("button", {
            name: "Play from 0:04: The billing migration is blocked on the tax provider.",
        });
        fireEvent.click(line);

        expect(video().currentTime).toBe(4);
        expect(playMock).toHaveBeenCalledTimes(1);
    });

    it("marks the line under the playhead", async () => {
        respondWith(preview());
        render(<MediaViewer document={DOC} />);
        await screen.findByTestId("file-player");

        act(() => {
            video().currentTime = 10;
            fireEvent.timeUpdate(video());
        });

        const current = screen.getByRole("button", { current: "time" });
        expect(current).toHaveAttribute("data-segment-index", "2");
    });

    it("cues the player to a cited passage without playing it", async () => {
        respondWith(preview());
        render(
            <MediaViewer
                document={DOC}
                highlight={{ text: "billing migration is blocked", nonce: 1 }}
            />
        );

        await waitFor(() => expect(video().currentTime).toBe(4));
        expect(document.querySelector('[data-segment-index="1"]')).toHaveAttribute("data-cited");
        expect(document.querySelector('[data-segment-index="0"]')).not.toHaveAttribute(
            "data-cited"
        );
        expect(playMock).not.toHaveBeenCalled();
    });

    it("marks every line a citation spans", async () => {
        respondWith(preview());
        render(
            <MediaViewer
                document={DOC}
                highlight={{
                    text: "blocked on the tax provider. We demo the new search",
                    nonce: 1,
                }}
            />
        );

        await waitFor(() =>
            expect(document.querySelector('[data-segment-index="2"]')).toHaveAttribute("data-cited")
        );
        expect(document.querySelector('[data-segment-index="1"]')).toHaveAttribute("data-cited");
    });

    it("reads a plain transcript from the transcript document when there are no timestamps", async () => {
        respondWith(
            preview({
                transcript: {
                    documentId: 3,
                    title: "memo (Transcription)",
                    language: "unknown",
                    segments: null,
                },
            })
        );
        render(<MediaViewer document={DOC} />);

        expect(
            await screen.findByText("Welcome to the weekly product standup. Billing is blocked.")
        ).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledWith("/api/documents/3/content");
        // "unknown" is not a language worth a badge.
        expect(screen.queryByText("UNKNOWN")).not.toBeInTheDocument();
    });

    it("highlights a cited passage in a plain transcript", async () => {
        // jsdom lays nothing out; give the located range a box to draw.
        Range.prototype.getClientRects = () =>
            [{ top: 10, left: 4, width: 120, height: 18 }] as unknown as DOMRectList;
        respondWith(
            preview({
                transcript: {
                    documentId: 3,
                    title: "memo (Transcription)",
                    language: "en",
                    segments: null,
                },
            })
        );
        render(<MediaViewer document={DOC} highlight={{ text: "Billing is blocked", nonce: 1 }} />);

        const box = await screen.findByTestId("transcript-cite-highlight");
        expect(box).toHaveStyle({ top: "10px", left: "4px", width: "120px", height: "18px" });
        // No timestamps to cue the player to.
        expect(video().currentTime).toBe(0);
    });

    it("shows audio as a deck, with the media element kept but hidden", async () => {
        respondWith(
            preview({
                kind: "audio",
                title: "memo.m4a",
                playback: {
                    type: "file",
                    documentId: 2,
                    url: "/api/documents/2/content",
                    mimeType: "audio/mp4",
                },
            })
        );
        render(<MediaViewer document={DOC} />);

        await screen.findByRole("button", { name: "Play" });
        expect(video()).not.toBeVisible();
        expect(video()).not.toHaveAttribute("controls");
        expect(screen.getByRole("slider", { name: "Seek" })).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "Download the file" })).toHaveAttribute(
            "href",
            "/api/documents/2/content"
        );

        fireEvent.click(screen.getByRole("button", { name: "Play" }));
        expect(playMock).toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Forward 10 seconds" }));
        expect(video().currentTime).toBe(10);
    });

    it("presents a video with no picture track as audio, without reloading it", async () => {
        respondWith(preview());
        render(<MediaViewer document={DOC} />);
        const element = (await screen.findByTestId("file-player")).querySelector("video")!;

        Object.defineProperty(element, "videoWidth", { configurable: true, value: 0 });
        fireEvent.loadedMetadata(element);

        expect(await screen.findByText(/Audio only/)).toBeInTheDocument();
        expect(video()).toBe(element);
    });

    it("offers a download when the browser cannot play the file", async () => {
        respondWith(preview());
        render(<MediaViewer document={DOC} />);
        await screen.findByTestId("file-player");

        fireEvent.error(video());

        expect(await screen.findByText(/can't be played here/)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: /Download/ })).toHaveAttribute(
            "href",
            "/api/documents/1/content"
        );
    });

    it("says when a recording has no transcript yet", async () => {
        respondWith(preview({ transcript: null }));
        render(<MediaViewer document={DOC} />);

        expect(await screen.findByText(/No transcript for this recording yet/)).toBeInTheDocument();
    });

    it("says when the recording behind a transcript is gone", async () => {
        respondWith(preview({ playback: null }));
        render(<MediaViewer document={DOC} />);

        expect(await screen.findByText(/original recording isn.t available/)).toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: /^Play from/ })).toHaveLength(3);
    });
});

describe("MediaViewer — a video imported by URL", () => {
    it("frames the platform's player and links to the page", async () => {
        respondWith(
            preview({
                playback: {
                    type: "embed",
                    provider: "youtube",
                    label: "YouTube",
                    embedUrl:
                        "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1",
                    watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    startSeconds: 0,
                },
            })
        );
        render(<MediaViewer document={DOC} />);

        const frame = await screen.findByTitle("standup.mp4 — YouTube player");
        expect(frame).toHaveAttribute(
            "src",
            "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&enablejsapi=1"
        );
        expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        expect(screen.getByRole("link", { name: /Open on YouTube/ })).toHaveAttribute(
            "href",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        );
    });

    it("seeks the framed player from a transcript line over postMessage", async () => {
        respondWith(
            preview({
                playback: {
                    type: "embed",
                    provider: "youtube",
                    label: "YouTube",
                    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1",
                    watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    startSeconds: 0,
                },
            })
        );
        render(<MediaViewer document={DOC} />);
        const frameWindow = windowOf(await screen.findByTitle<HTMLIFrameElement>(/YouTube player/));
        const postMessage = jest.spyOn(frameWindow, "postMessage");

        fireEvent.click(screen.getByRole("button", { name: /^Play from 0:09/ }));

        // postMessage is overloaded, so its recorded calls are loosely typed.
        const calls = postMessage.mock.calls as unknown as [string, string][];
        const sent = calls.map(([message, origin]) => [
            JSON.parse(message) as { func?: string; args?: unknown[] },
            origin,
        ]);
        expect(sent).toEqual([
            [
                expect.objectContaining({ func: "seekTo", args: [9.5, true] }),
                "https://www.youtube-nocookie.com",
            ],
            [expect.objectContaining({ func: "playVideo" }), "https://www.youtube-nocookie.com"],
        ]);
    });

    it("follows the framed player's playhead, trusting only that frame and origin", async () => {
        respondWith(
            preview({
                playback: {
                    type: "embed",
                    provider: "youtube",
                    label: "YouTube",
                    embedUrl: "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1",
                    watchUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                    startSeconds: 0,
                },
            })
        );
        render(<MediaViewer document={DOC} />);
        const frameWindow = windowOf(await screen.findByTitle<HTMLIFrameElement>(/YouTube player/));
        const delivery = (currentTime: number) =>
            JSON.stringify({ event: "infoDelivery", info: { currentTime } });
        const post = (init: MessageEventInit) =>
            act(() => {
                window.dispatchEvent(new MessageEvent("message", init));
            });

        // Another origin, or another window, is ignored.
        post({ data: delivery(5), origin: "https://evil.example", source: frameWindow });
        post({ data: delivery(5), origin: "https://www.youtube-nocookie.com", source: window });
        expect(screen.queryByRole("button", { current: "time" })).not.toBeInTheDocument();

        post({
            data: delivery(5),
            origin: "https://www.youtube-nocookie.com",
            source: frameWindow,
        });
        expect(screen.getByRole("button", { current: "time" })).toHaveAttribute(
            "data-segment-index",
            "1"
        );
    });

    it("links out to a platform that cannot be framed", async () => {
        respondWith(
            preview({
                playback: {
                    type: "link",
                    url: "https://www.tiktok.com/@a/video/1",
                    label: "TikTok",
                },
            })
        );
        render(<MediaViewer document={DOC} />);

        const link = await screen.findByRole("link", { name: /Watch on TikTok/ });
        expect(link).toHaveAttribute("href", "https://www.tiktok.com/@a/video/1");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });
});

describe("MediaViewer — failures", () => {
    it("explains a failed lookup and retries on request", async () => {
        respondWith({ error: "This document has no audio or video" }, { status: 404 });
        render(<MediaViewer document={DOC} />);

        expect(await screen.findByText("This document has no audio or video")).toBeInTheDocument();

        respondWith(preview());
        fireEvent.click(screen.getByRole("button", { name: /Try again/ }));

        expect(await screen.findByTestId("file-player")).toBeInTheDocument();
    });
});
