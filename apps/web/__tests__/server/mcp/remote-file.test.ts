/**
 * Fetching a ChatGPT file argument: https on every hop, the SSRF guard on
 * every hop, a size cap whether or not the server declares a length, and
 * plain-words errors. The guard is real; the network is a stub, and URLs use
 * literal addresses so no DNS is involved.
 */
import { downloadAssistantFile, RemoteFileError } from "~/server/mcp/remote-file";
import { fetchPublicUrl, UrlGuardError } from "~/server/security/url-guard";

const PUBLIC = "https://93.184.216.34";
const fetchMock = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
});

function redirect(location: string): Response {
    return new Response(null, { status: 302, headers: { location } });
}

function chunked(...parts: number[]): ReadableStream<Uint8Array> {
    return new ReadableStream({
        start(controller) {
            for (const size of parts) controller.enqueue(new Uint8Array(size));
            controller.close();
        },
    });
}

describe("downloadAssistantFile", () => {
    it("downloads a public https file and passes its type on", async () => {
        fetchMock.mockResolvedValueOnce(
            new Response("%PDF-1.7", {
                status: 200,
                headers: { "content-type": "application/pdf" },
            })
        );
        const file = await downloadAssistantFile(`${PUBLIC}/f.pdf`);
        expect(file.data.toString()).toBe("%PDF-1.7");
        expect(file.contentType).toBe("application/pdf");
        expect(fetchMock.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
    });

    it("refuses anything but https before fetching", async () => {
        for (const url of [
            "http://93.184.216.34/f.pdf",
            "ftp://93.184.216.34/f",
            "file:///etc/passwd",
            "not a url",
        ]) {
            await expect(downloadAssistantFile(url)).rejects.toBeInstanceOf(RemoteFileError);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses private and loopback addresses", async () => {
        for (const url of [
            "https://127.0.0.1/f",
            "https://10.0.0.5/f",
            "https://169.254.169.254/latest",
            "https://[::1]/f",
        ]) {
            await expect(downloadAssistantFile(url)).rejects.toThrow(/will not fetch from/);
        }
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses a redirect that downgrades to http, or that points inside", async () => {
        fetchMock.mockResolvedValueOnce(redirect("http://93.184.216.34/plain"));
        await expect(downloadAssistantFile(`${PUBLIC}/a`)).rejects.toThrow(/will not fetch from/);
        fetchMock.mockResolvedValueOnce(redirect("https://10.0.0.5/inside"));
        await expect(downloadAssistantFile(`${PUBLIC}/b`)).rejects.toThrow(/will not fetch from/);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("follows an https redirect to a public host", async () => {
        fetchMock
            .mockResolvedValueOnce(redirect("https://93.184.216.35/final.pdf"))
            .mockResolvedValueOnce(new Response("ok", { status: 200 }));
        await expect(downloadAssistantFile(`${PUBLIC}/start`)).resolves.toMatchObject({
            contentType: expect.any(String),
        });
    });

    it("refuses a file over the cap, declared or streamed", async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(chunked(4), { status: 200, headers: { "content-length": "100" } })
        );
        await expect(downloadAssistantFile(`${PUBLIC}/declared`, 50)).rejects.toThrow(
            /larger than/
        );
        fetchMock.mockResolvedValueOnce(new Response(chunked(30, 30), { status: 200 }));
        await expect(downloadAssistantFile(`${PUBLIC}/streamed`, 50)).rejects.toThrow(
            /larger than/
        );
    });

    it("says the link may have expired when the host answers an error", async () => {
        fetchMock.mockResolvedValueOnce(new Response("gone", { status: 403 }));
        await expect(downloadAssistantFile(`${PUBLIC}/old`)).rejects.toThrow(/HTTP 403.*expired/);
    });
});

describe("fetchPublicUrl without httpsOnly (other callers)", () => {
    it("still follows a public http hop, as before", async () => {
        fetchMock
            .mockResolvedValueOnce(redirect("http://93.184.216.35/page"))
            .mockResolvedValueOnce(new Response("page", { status: 200 }));
        const response = await fetchPublicUrl(`${PUBLIC}/start`);
        expect(response.status).toBe(200);
    });

    it("refuses an http hop only when asked to", async () => {
        fetchMock.mockResolvedValueOnce(redirect("http://93.184.216.35/page"));
        await expect(
            fetchPublicUrl(`${PUBLIC}/start`, undefined, { httpsOnly: true })
        ).rejects.toBeInstanceOf(UrlGuardError);
    });
});
