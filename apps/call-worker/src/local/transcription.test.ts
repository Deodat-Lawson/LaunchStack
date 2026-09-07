import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { test } from "node:test";

import {
    AzureSpeechFastTranscriptionModel,
    OpenAiCompatibleTranscriptionModel,
} from "./transcription";

type RequestRecord = {
    method: string | undefined;
    url: string | undefined;
    authorization: string | undefined;
    subscriptionKey: string | undefined;
    contentType: string | undefined;
    body: Buffer;
};

type RequestHandler = (
    request: IncomingMessage,
    response: ServerResponse,
    body: Buffer
) => void | Promise<void>;

async function readBody(request: IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
}

async function startServer(handler: RequestHandler): Promise<{ server: Server; origin: string }> {
    const server = createServer((request, response) => {
        void readBody(request)
            .then(body => handler(request, response, body))
            .catch(error => {
                if (!response.writableEnded) {
                    response.statusCode = 500;
                    response.end(error instanceof Error ? error.message : "handler failed");
                }
            });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        await stopServer(server);
        throw new Error("test server did not expose a TCP address");
    }
    return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function stopServer(server: Server): Promise<void> {
    server.closeAllConnections();
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
        server.close(error => {
            if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(value));
}

test("OpenAiCompatibleTranscriptionModel sends WAV multipart data to the configured endpoint", async () => {
    const requests: RequestRecord[] = [];
    const { server, origin } = await startServer((request, response, body) => {
        requests.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            contentType: request.headers["content-type"],
            subscriptionKey:
                typeof request.headers["ocp-apim-subscription-key"] === "string"
                    ? request.headers["ocp-apim-subscription-key"]
                    : undefined,
            body,
        });
        jsonResponse(response, 200, { text: "  transcript from local model  " });
    });

    try {
        const audioWav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);
        const model = new OpenAiCompatibleTranscriptionModel({
            baseUrl: `${origin}/v1/`,
            model: "tiny-whisper",
            apiKey: "local-secret",
        });
        const text = await model.transcribe({ audioWav, language: " en " });

        assert.equal(text, "  transcript from local model  ");
        assert.equal(requests.length, 1);
        const request = requests[0]!;
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/v1/audio/transcriptions");
        assert.equal(request.authorization, "Bearer local-secret");
        assert.match(request.contentType ?? "", /^multipart\/form-data; boundary=/);

        const body = request.body.toString("latin1");
        assert.match(body, /name="model"\r\n\r\ntiny-whisper/);
        assert.match(body, /name="language"\r\n\r\nen/);
        assert.match(body, /filename="audio\.wav"/);
        assert.notEqual(request.body.indexOf(Buffer.from(audioWav)), -1);
    } finally {
        await stopServer(server);
    }
});

test("AzureSpeechFastTranscriptionModel uses the Azure Fast Transcription contract", async () => {
    const requests: RequestRecord[] = [];
    const { server, origin } = await startServer((request, response, body) => {
        requests.push({
            method: request.method,
            url: request.url,
            authorization: request.headers.authorization,
            subscriptionKey:
                typeof request.headers["ocp-apim-subscription-key"] === "string"
                    ? request.headers["ocp-apim-subscription-key"]
                    : undefined,
            contentType: request.headers["content-type"],
            body,
        });
        jsonResponse(response, 200, {
            combinedPhrases: [{ text: " Meeting " }, { text: "notes" }],
        });
    });
    try {
        const audioWav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);
        const model = new AzureSpeechFastTranscriptionModel({
            endpoint: origin,
            apiKey: "speech-secret",
        });
        const text = await model.transcribe({ audioWav, language: "en-US" });

        assert.equal(text, "Meeting notes");
        assert.equal(requests.length, 1);
        const request = requests[0]!;
        assert.equal(request.method, "POST");
        assert.equal(request.url, "/speechtotext/transcriptions:transcribe?api-version=2025-10-15");
        assert.equal(request.authorization, undefined);
        assert.equal(request.subscriptionKey, "speech-secret");
        assert.match(request.contentType ?? "", /^multipart\/form-data; boundary=/);
        const body = request.body.toString("latin1");
        assert.match(body, /name="audio"; filename="audio\.wav"/);
        assert.match(body, /name="definition"\r\n\r\n\{"locales":\["en-US"\]\}/);
        assert.notEqual(request.body.indexOf(Buffer.from(audioWav)), -1);
    } finally {
        await stopServer(server);
    }
});

test("AzureSpeechFastTranscriptionModel treats no recognized speech as an empty transcript", async () => {
    const { server, origin } = await startServer((_request, response) => {
        jsonResponse(response, 200, { combinedPhrases: [] });
    });
    try {
        const model = new AzureSpeechFastTranscriptionModel({
            endpoint: origin,
            apiKey: "speech-secret",
        });

        assert.equal(await model.transcribe({ audioWav: new Uint8Array([1, 2]) }), "");
    } finally {
        await stopServer(server);
    }
});

test("OpenAiCompatibleTranscriptionModel converts a stalled request into a timeout", async () => {
    const { server, origin } = await startServer((_request, _response) => {
        // Keep the HTTP response open until the model's AbortSignal closes it.
    });

    try {
        const model = new OpenAiCompatibleTranscriptionModel({
            baseUrl: origin,
            model: "timeout-model",
            timeoutMs: 20,
        });
        await assert.rejects(
            model.transcribe({ audioWav: new Uint8Array([1, 2]) }),
            /transcription request timed out after 20ms/
        );
    } finally {
        await stopServer(server);
    }
});

test("OpenAiCompatibleTranscriptionModel reports non-2xx responses with server detail", async () => {
    const { server, origin } = await startServer((_request, response) => {
        response.statusCode = 422;
        response.end("model rejected audio");
    });

    try {
        const model = new OpenAiCompatibleTranscriptionModel({ baseUrl: origin });
        await assert.rejects(
            model.transcribe({ audioWav: new Uint8Array([1, 2]) }),
            /transcription request failed \(422\): model rejected audio/
        );
    } finally {
        await stopServer(server);
    }
});

test("OpenAiCompatibleTranscriptionModel rejects an empty response transcript", async () => {
    const { server, origin } = await startServer((_request, response) => {
        jsonResponse(response, 200, { text: " \n\t " });
    });

    try {
        const model = new OpenAiCompatibleTranscriptionModel({ baseUrl: origin });
        await assert.rejects(
            model.transcribe({ audioWav: new Uint8Array([1, 2]) }),
            /transcription response text must not be empty/
        );
    } finally {
        await stopServer(server);
    }
});
