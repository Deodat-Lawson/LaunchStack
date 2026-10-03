import { createChatStream, readChatStream } from "~/lib/chat-stream";

describe("chat stream protocol", () => {
    it("preserves UTF-8 at every possible split boundary and accepts a final line without newline", async () => {
        const wire = new TextEncoder().encode(
            '\n{"type":"text","delta":"é🎉"}\r\n{"type":"result","response":{"success":true,"summarizedAnswer":"é🎉"}}'
        );
        for (let split = 1; split < wire.length; split++) {
            const response = new Response(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(wire.slice(0, split));
                        controller.enqueue(wire.slice(split));
                        controller.close();
                    },
                })
            );
            const onEvent = jest.fn();
            await expect(
                readChatStream(response, new AbortController().signal, onEvent)
            ).resolves.toEqual({ success: true, summarizedAnswer: "é🎉" });
            expect(onEvent).toHaveBeenCalledWith({ type: "text", delta: "é🎉" });
        }
    });

    it("rejects invalid result payloads instead of fabricating success", async () => {
        await expect(
            readChatStream(
                new Response('{"type":"result","response":{"summarizedAnswer":"hello"}}\n'),
                new AbortController().signal
            )
        ).rejects.toThrow("Invalid chat stream event");
    });

    it("propagates request aborts to server work and never emits a final result", async () => {
        const caller = new AbortController();
        let workSignal!: AbortSignal;
        let release!: () => void;
        const response = createChatStream(caller.signal, async (emit, signal) => {
            workSignal = signal;
            emit({ type: "text", delta: "partial" });
            await new Promise<void>(resolve => {
                release = resolve;
            });
            return { success: true };
        });
        caller.abort();
        expect(workSignal.aborted).toBe(true);
        release();
        expect(await response.text()).not.toContain('"type":"result"');
    });
});
