/**
 * A request body must reach the route handler whole after middleware ran.
 *
 * Our middleware runs on the Node.js runtime (`config.runtime = "nodejs"` in
 * src/middleware.ts), so Next tees every POST body: one copy streams into the
 * middleware's Request, the other is buffered (`getCloneableBody`). When the
 * middleware returns, `finalize()` waits for the upload to finish and swaps
 * the buffered copy back onto the request for the route handler. Next 15.5.7
 * calls `requestData.body.finalize()` without awaiting it
 * (dist/server/next-server.js), so the route handler can start while the
 * upload is still streaming and read the half-drained original. Small JSON
 * bodies usually arrive with the headers and win the race; a multipart upload
 * loses it. Prod answered a 134 KB resume attached in chat with "Failed to
 * upload file to storage" (`TypeError: Failed to parse body as FormData.`),
 * and the same upload on localhost failed with "Response body object should
 * not be disturbed or locked".
 *
 * Next 16 awaits it; we carry the one-word fix in `patches/next@15.5.7.patch`.
 * This fails if an install or a Next bump loses it, and drives Next's own
 * body-stream helper to show why the await matters.
 */

import { readFileSync } from "node:fs";
import { Readable } from "node:stream";

type CloneableBody = {
    cloneBodyStream(): Readable;
    finalize(): Promise<void>;
};
type BodyStreams = {
    getCloneableBody(readable: Readable, sizeLimit?: number): CloneableBody;
};

const { getCloneableBody } = jest.requireActual<BodyStreams>("next/dist/server/body-streams");

const boundary = "----WebKitFormBoundaryAbCdEfGh12345678";
const fileBytes = Buffer.alloc(134 * 1024, "resume ");
const multipart = Buffer.concat([
    Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="Khushi Desai Resume.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
    ),
    fileBytes,
    Buffer.from(
        `\r\n--${boundary}\r\nContent-Disposition: form-data; name="purpose"\r\n\r\nchat\r\n--${boundary}--\r\n`
    ),
]);

/** An incoming upload that arrives in network-sized pieces over several ticks. */
function slowUpload(): Readable & { url: string } {
    let offset = 0;
    const stream = new Readable({
        read() {
            setTimeout(() => {
                const chunk = multipart.subarray(offset, offset + 16 * 1024);
                offset += chunk.length;
                this.push(chunk.length ? chunk : null);
            }, 2);
        },
    });
    return Object.assign(stream, { url: "/api/storage/upload" });
}

/** How the app route adapter builds the handler's Request from the node request. */
function routeHandlerRequest(body: Readable) {
    return new Request("http://localhost/api/storage/upload", {
        method: "POST",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        body: body as unknown as ReadableStream,
        duplex: "half",
    } as RequestInit);
}

/** Next's middleware hand-off: tee the body, let middleware run, then finalize. */
async function middlewareRan(req: Readable) {
    const body = getCloneableBody(req, 128 * 1024 * 1024);
    const middlewareCopy = body.cloneBodyStream();
    // The middleware reads only headers; its copy is never consumed.
    await new Promise(resolve => setTimeout(resolve, 5));
    return { body, middlewareCopy };
}

describe("request bodies after Node.js middleware", () => {
    it.each(["dist/server/next-server.js", "dist/esm/server/next-server.js"])(
        "the installed Next awaits the body hand-off (%s)",
        file => {
            const source = readFileSync(require.resolve(`next/${file}`), "utf8");
            expect(source).toContain("await requestData.body.finalize();");
            expect(source).not.toMatch(/^\s*requestData\.body\.finalize\(\);$/m);
        }
    );

    it("reading the body before the hand-off finishes fails, as prod did", async () => {
        const req = slowUpload();
        const { body } = await middlewareRan(req);
        void body.finalize(); // Next 15.5.7, unpatched
        expect(() => routeHandlerRequest(req)).toThrow(/disturbed or locked/);
    });

    it("awaiting the hand-off gives the route handler the whole upload", async () => {
        const req = slowUpload();
        const { body } = await middlewareRan(req);
        await body.finalize(); // patches/next@15.5.7.patch
        const form = await routeHandlerRequest(req).formData();
        const file = form.get("file") as File;
        expect(file.name).toBe("Khushi Desai Resume.pdf");
        expect(Buffer.from(await file.arrayBuffer()).equals(fileBytes)).toBe(true);
        expect(form.get("purpose")).toBe("chat");
    });
});
