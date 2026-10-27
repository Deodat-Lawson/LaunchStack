/** @jest-environment jsdom */

import { act, renderHook } from "@testing-library/react";

import {
    UPLOAD_CONCURRENCY,
    dismissLocalTask,
    hasUnfinishedLocalTasks,
    onLocalTaskHandedOff,
    resetLocalTasksForTests,
    retryLocalTask,
    startFileUploads,
    startLinkTask,
    useLocalTasks,
} from "../processing/uploadTasks";

/**
 * The browser half of a file's trip: bytes up two at a time with progress,
 * then registering, then handing the server's job to the queue — and a
 * failure that stays put with Retry instead of vanishing with the dialog.
 */

const mockUpload = jest.fn();
const mockRegister = jest.fn();
jest.mock("../sourceUpload", () => ({
    uploadFileToStorage: (file: File, options: unknown) => mockUpload(file, options),
    registerDocument: (params: unknown) => mockRegister(params),
}));

async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function file(name: string, size = 1000) {
    return new File([new Uint8Array(size)], name, { type: "application/pdf" });
}

beforeEach(() => {
    resetLocalTasksForTests();
    mockUpload.mockReset();
    mockRegister.mockReset();
});

describe("startFileUploads", () => {
    it("uploads two at a time, reports bytes, and hands each job over", async () => {
        const uploads = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
        let call = 0;
        mockUpload.mockImplementation(
            (_file: File, options: { onProgress: (l: number, t: number) => void }) => {
                const mine = uploads[call++]!;
                options.onProgress(250, 1000);
                return mine.promise;
            }
        );
        mockRegister.mockImplementation((params: { file: File }) =>
            Promise.resolve({ jobId: `job-${params.file.name}`, documentId: 7 })
        );
        const handed: string[] = [];
        onLocalTaskHandedOff(task => handed.push(task.jobIds[0]!));
        const { result } = renderHook(() => useLocalTasks());

        act(() => {
            startFileUploads([
                { file: file("a.pdf"), category: "Board" },
                { file: file("b.pdf"), category: "Board" },
                { file: file("c.pdf"), category: "Board" },
            ]);
        });
        const latest = result.current;
        expect(UPLOAD_CONCURRENCY).toBe(2);
        expect(mockUpload).toHaveBeenCalledTimes(2);
        expect(latest.map(t => [t.name, t.phase])).toEqual([
            ["a.pdf", "uploading"],
            ["b.pdf", "uploading"],
            ["c.pdf", "waiting"],
        ]);
        expect(latest[0]).toMatchObject({ loaded: 250, total: 1000 });
        expect(hasUnfinishedLocalTasks()).toBe(true);

        await act(async () => {
            uploads[0]!.resolve({ url: "s3://a", provider: "s3" });
            await flush();
        });
        // a is registered and handed off; c takes the free slot.
        expect(mockUpload).toHaveBeenCalledTimes(3);
        expect(mockRegister).toHaveBeenCalledWith(
            expect.objectContaining({ url: "s3://a", category: "Board" })
        );
        expect(handed).toEqual(["job-a.pdf"]);
        expect(result.current.find(t => t.name === "a.pdf")).toMatchObject({
            phase: "handed-off",
            jobIds: ["job-a.pdf"],
        });

        await act(async () => {
            uploads[1]!.resolve({ url: "s3://b", provider: "s3" });
            uploads[2]!.resolve({ url: "s3://c", provider: "s3" });
            await flush();
        });
        expect(handed.sort()).toEqual(["job-a.pdf", "job-b.pdf", "job-c.pdf"]);
        expect(hasUnfinishedLocalTasks()).toBe(false);
    });

    it("says a recording is being transcribed while the register call runs", async () => {
        const register = deferred<unknown>();
        mockUpload.mockResolvedValue({ url: "s3://r", provider: "s3" });
        mockRegister.mockReturnValue(register.promise);
        const { result } = renderHook(() => useLocalTasks());
        await act(async () => {
            startFileUploads([
                { file: new File(["x"], "call.m4a", { type: "audio/mp4" }), category: "" },
            ]);
            await flush();
        });
        expect(result.current[0]).toMatchObject({
            phase: "working",
            workLabel: "Transcribing the recording",
        });
        await act(async () => {
            register.resolve({ jobId: "job-r", documentId: 3 });
            await flush();
        });
        expect(result.current[0]!.phase).toBe("handed-off");
    });

    it("keeps a failed upload with its reason, retries it, and can dismiss it", async () => {
        mockUpload
            .mockRejectedValueOnce(new Error("deck.pdf: upload failed (HTTP 413)"))
            .mockResolvedValueOnce({ url: "s3://d", provider: "s3" });
        mockRegister.mockResolvedValue({ jobId: "job-d", documentId: 4 });
        const { result } = renderHook(() => useLocalTasks());
        await act(async () => {
            startFileUploads([{ file: file("deck.pdf"), category: "" }]);
            await flush();
        });
        expect(result.current[0]).toMatchObject({
            phase: "failed",
            error: "deck.pdf: upload failed (HTTP 413)",
        });

        await act(async () => {
            retryLocalTask(result.current[0]!.id);
            await flush();
        });
        expect(result.current[0]).toMatchObject({ phase: "handed-off", jobIds: ["job-d"] });

        act(() => dismissLocalTask(result.current[0]!.id));
        expect(result.current).toHaveLength(0);
    });
});

describe("startLinkTask", () => {
    it("shows the server's work, then the job it started", async () => {
        const answer = deferred<{ jobIds: string[] }>();
        const { result } = renderHook(() => useLocalTasks());
        act(() => {
            startLinkTask({
                name: "https://example.com",
                category: "Research",
                workLabel: "Fetching the page",
                run: () => answer.promise,
            });
        });
        expect(result.current[0]).toMatchObject({
            kind: "link",
            phase: "working",
            workLabel: "Fetching the page",
        });
        await act(async () => {
            answer.resolve({ jobIds: ["job-page"] });
            await flush();
        });
        expect(result.current[0]).toMatchObject({ phase: "handed-off", jobIds: ["job-page"] });
    });

    it("keeps the server's refusal as the reason", async () => {
        const { result } = renderHook(() => useLocalTasks());
        await act(async () => {
            startLinkTask({
                name: "https://example.com",
                category: "",
                workLabel: "Fetching the page",
                run: () => Promise.reject(new Error("There is no text on example.com we can read")),
            });
            await flush();
        });
        expect(result.current[0]).toMatchObject({
            phase: "failed",
            error: "There is no text on example.com we can read",
        });
    });
});
