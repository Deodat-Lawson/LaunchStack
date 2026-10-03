/**
 * The headers every route that serves a stored upload inline goes through.
 * The stored type is the uploader's claim, so these pin two promises: nothing
 * a browser could execute leaves without the sandbox, and the type the browser
 * reads is the one the policy judged.
 */

import { storedFileHeaders } from "~/server/security/stored-file-headers";

const SANDBOX = "Content-Security-Policy";

describe("storedFileHeaders", () => {
    it.each([
        "text/html",
        "image/svg+xml",
        "application/xhtml+xml",
        "text/xml",
        "application/xml",
        "image/vnd.example+xml",
        "text/plain",
        "application/octet-stream",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ])("sandboxes %s", type => {
        const headers = storedFileHeaders(type);

        expect(headers[SANDBOX]).toBe("sandbox");
        expect(headers["Content-Type"]).toBe(type);
    });

    it.each([
        "application/pdf",
        "image/png",
        "image/jpeg",
        "image/webp",
        "audio/mpeg",
        "video/mp4",
    ])("serves %s as it is, outside the sandbox", type => {
        const headers = storedFileHeaders(type);

        expect(headers[SANDBOX]).toBeUndefined();
        expect(headers["Content-Type"]).toBe(type);
    });

    it("always holds the browser to the declared type", () => {
        expect(storedFileHeaders("image/png")["X-Content-Type-Options"]).toBe("nosniff");
        expect(storedFileHeaders("text/html")["X-Content-Type-Options"]).toBe("nosniff");
    });

    it("judges the type case-insensitively", () => {
        expect(storedFileHeaders("TEXT/HTML")).toMatchObject({
            "Content-Type": "text/html",
            [SANDBOX]: "sandbox",
        });
        expect(storedFileHeaders("Image/SVG+XML")[SANDBOX]).toBe("sandbox");
    });

    it("never echoes a list a browser would read as its last entry", () => {
        // Browsers take the last parseable entry of a comma-separated
        // Content-Type, so an allowlisted head must not smuggle text/html.
        expect(storedFileHeaders("image/png, text/html")).toMatchObject({
            "Content-Type": "application/octet-stream",
            [SANDBOX]: "sandbox",
        });
        expect(storedFileHeaders("image/png; x=1, text/html")["Content-Type"]).toBe("image/png");
    });

    it("keeps a well-formed charset and drops every other parameter", () => {
        expect(storedFileHeaders("text/plain; charset=UTF-8")["Content-Type"]).toBe(
            "text/plain; charset=utf-8"
        );
        expect(storedFileHeaders('text/html;foo=bar; charset="utf-8"')["Content-Type"]).toBe(
            "text/html; charset=utf-8"
        );
        expect(storedFileHeaders("text/html; boundary=x")["Content-Type"]).toBe("text/html");
    });

    it.each([null, undefined, "", "html", "*/*", "text/html\r\nSet-Cookie: a=1"])(
        "serves an unparseable type (%p) as sandboxed opaque bytes",
        type => {
            expect(storedFileHeaders(type)).toMatchObject({
                "Content-Type": "application/octet-stream",
                [SANDBOX]: "sandbox",
            });
        }
    );

    it("does not let a charset carry anything else into the header", () => {
        expect(storedFileHeaders("text/plain; charset=utf-8\r\nX-Evil: 1")["Content-Type"]).toBe(
            "text/plain"
        );
    });
});
