/**
 * CI-only OpenAI-compatible embeddings stub for the Docker Compose smoke
 * test. Deterministic hash-based vectors — no network, no credentials, no
 * model. NEVER wired outside CI: the smoke overlay points AI_BASE_URL here.
 *
 * Implements just enough of POST /v1/embeddings for the engine's OpenAI
 * embeddings client: {input: string|string[], model} →
 * {data: [{embedding, index}], usage}.
 *
 * Usage: node scripts/ci/fake-embeddings-server.mjs [port]
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = Number(process.argv[2] ?? 8099);
const DIMENSION = 1536;

function embed(text) {
  // Seed a repeatable pseudo-vector from the content hash so identical
  // chunks embed identically (exercises the pipeline's dedup honestly).
  const seed = createHash("sha256").update(text).digest();
  const vector = new Array(DIMENSION);
  let a = seed.readUInt32LE(0) || 1;
  for (let i = 0; i < DIMENSION; i++) {
    // xorshift32
    a ^= a << 13;
    a ^= a >>> 17;
    a ^= a << 5;
    a >>>= 0;
    vector[i] = (a / 0xffffffff) * 2 - 1;
  }
  // L2-normalize so cosine math behaves.
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

// Documents registered by POST /docs, for bodies too long to ride in a URL
// (the document table's url column is varchar(256)). Keyed by content hash
// so re-registering the same text yields the same URL.
const registered = new Map();

const server = createServer((req, res) => {
  // GET /doc/<base64url> — serves a text document for the e2e ingestion
  // smoke (the pipeline fetches documentUrl over HTTP like any storage ref).
  if (req.method === "GET" && req.url?.startsWith("/doc/")) {
    try {
      const text = Buffer.from(req.url.slice(5), "base64url").toString("utf8");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(text);
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
    return;
  }
  // GET /docs/<sha256> — a document registered below.
  if (req.method === "GET" && req.url?.startsWith("/docs/")) {
    const entry = registered.get(req.url.slice(6));
    if (!entry) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "no such document" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": entry.contentType });
    res.end(entry.text);
    return;
  }
  // POST /docs {text, contentType?} → {id, path} — register a long document.
  if (req.method === "POST" && req.url === "/docs") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body);
        const text = String(parsed.text ?? "");
        const id = createHash("sha256").update(text).digest("hex");
        registered.set(id, {
          text,
          contentType: parsed.contentType ?? "text/plain; charset=utf-8",
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, path: `/docs/${id}` }));
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: String(error) } }));
      }
    });
    return;
  }
  if (req.method !== "POST" || !req.url?.includes("/embeddings")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `no route: ${req.url}` } }));
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    try {
      const parsed = JSON.parse(body);
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      const data = inputs.map((text, index) => ({
        object: "embedding",
        index,
        embedding: embed(String(text)),
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          object: "list",
          data,
          model: parsed.model ?? "fake-embeddings",
          usage: { prompt_tokens: 0, total_tokens: 0 },
        }),
      );
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`fake-embeddings-server listening on :${PORT}`);
});
