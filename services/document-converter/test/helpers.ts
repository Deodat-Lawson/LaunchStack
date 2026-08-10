/**
 * Shared test plumbing: an in-process app bound to an ephemeral loopback
 * port (no external network anywhere), a base config, and the ajv validator
 * compiled from the CANONICAL EvidenceDocument JSON Schema in
 * packages/protocol — so contract drift fails these tests.
 */
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv, type ValidateFunction } from "ajv";
import * as ajvFormatsModule from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";

// ajv-formats is CJS with an ESM-style default in its types; grab the
// callable through the namespace (and pin its type) so both the NodeNext
// typecheck and the vitest runtime agree.
const addFormats = ajvFormatsModule.default as unknown as FormatsPlugin;

import { createApp, type AppDeps } from "../src/app.js";
import type { Config } from "../src/config.js";

export const TEST_API_KEY = "test-api-key";
export const ALLOWED_ORIGIN = "http://files.test";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    apiKey: TEST_API_KEY,
    doclingServeTimeoutMs: 5_000,
    fetchTimeoutMs: 5_000,
    maxFetchBytes: 10 * 1024 * 1024,
    allowedFetchOrigins: [ALLOWED_ORIGIN],
    ...overrides,
  };
}

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startApp(
  config: Config,
  deps: AppDeps = {},
): Promise<TestServer> {
  const app = createApp(config, deps);
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

export function postJson(
  base: string,
  route: string,
  body: unknown,
  apiKey: string | null = TEST_API_KEY,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(base + route, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey === null ? {} : { "X-API-Key": apiKey }),
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

export function getJson(
  base: string,
  route: string,
  apiKey: string | null = TEST_API_KEY,
): Promise<Response> {
  return fetch(base + route, {
    headers: apiKey === null ? {} : { "X-API-Key": apiKey },
  });
}

/** fetchImpl stub serving fixed bytes for any allow-listed document URL. */
export function bytesFetch(
  bytes: Uint8Array,
  contentType = "application/pdf",
): (url: string, init?: RequestInit) => Promise<Response> {
  return async () =>
    new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "Content-Type": contentType },
    });
}

/** fetchImpl that fails the test if the service tries any outbound fetch. */
export function forbiddenFetch(
  calls: string[] = [],
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url) => {
    calls.push(url);
    throw new Error(`unexpected outbound fetch: ${url}`);
  };
}

const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/protocol/schemas/v1/evidence-document.schema.json",
);

const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);

export const validateEvidenceDocument: ValidateFunction = ajv.compile(
  JSON.parse(readFileSync(schemaPath, "utf8")),
);

export function expectValidEvidenceDocument(doc: unknown): void {
  const valid = validateEvidenceDocument(doc);
  if (!valid) {
    throw new Error(
      `EvidenceDocument failed canonical schema validation: ${JSON.stringify(validateEvidenceDocument.errors, null, 2)}`,
    );
  }
}
