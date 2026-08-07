/**
 * Architectural guardrails, enforced as tests rather than review habits.
 *
 * The value of a single chat boundary evaporates the first time a feature
 * constructs its own client: that path silently skips route resolution,
 * declared-behavior filtering, and usage normalization, and can pick up an
 * unrelated API key from the environment.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// __dirname is apps/web/__tests__/lib/llm — five levels up is the repo root.
const repoRoot = join(__dirname, "..", "..", "..", "..", "..");

const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/**
 * Recursive walk rather than `fs.globSync`: this suite runs in CI's *blocking*
 * test step, and `globSync` needs Node >= 22 while CI pins Node 20.
 */
function walk(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(join(repoRoot, dir), { withFileTypes: true });
  } catch {
    return out; // Directory absent in this checkout — nothing to enforce.
  }
  for (const entry of entries) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      if (entry.name === ".next" || entry.name === "dist") continue;
      walk(rel, out);
    } else if (
      SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext)) &&
      !entry.name.endsWith(".d.ts")
    ) {
      out.push(rel);
    }
  }
  return out;
}

function sourceFiles(root: string): string[] {
  return walk(root);
}

function read(file: string): string {
  return readFileSync(join(repoRoot, file), "utf8");
}

/**
 * Chat *model* classes only. `OpenAIEmbeddings` and `OllamaEmbeddings` come
 * from the same packages but belong to the embeddings capability, which is
 * configured separately and deliberately.
 */
const CHAT_MODEL_IMPORT =
  /^\s*import\s+[^;]*\b(ChatOpenAI|ChatAnthropic|ChatGoogleGenerativeAI|ChatOllama)\b[^;]*from\s+["']@langchain\//m;

describe("chat SDK imports", () => {
  const TRANSPORT = join(
    "packages",
    "core",
    "src",
    "llm",
    "openai-compatible-transport.ts",
  );

  it("restricts chat model construction to the single transport module", () => {
    const offenders = [
      ...sourceFiles("packages"),
      ...sourceFiles("apps/web/src"),
    ].filter((file) => {
      if (relative(TRANSPORT, file) === "") return false;
      return CHAT_MODEL_IMPORT.test(read(file));
    });

    expect(offenders).toEqual([]);
  });

  it("keeps the transport itself importing exactly one chat SDK", () => {
    const transport = read(TRANSPORT);
    expect(transport).toMatch(/from "@langchain\/openai"/);
    expect(transport).not.toMatch(/@langchain\/(anthropic|google-genai|ollama)/);
  });
});

describe("chat consumers use the resolver", () => {
  const consumers = [
    ...sourceFiles("apps/web/src"),
    ...sourceFiles("packages/features/src"),
  ].filter((file) => {
    const source = read(file);
    return (
      /resolveChatModel|resolveConfiguredChatModel|invokeStructured/.test(source) &&
      !file.endsWith("chat-model-factory.ts") &&
      !file.endsWith("structured-output.ts")
    );
  });

  it("finds the expected consumers", () => {
    expect(consumers.length).toBeGreaterThan(10);
  });

  it("never references a removed provider or profile API", () => {
    const removed = [
      "getChatModelByType",
      "getChatModelForProvider",
      "getProviderDefaultModel",
      "inferProviderFromModel",
      "registerChatProviderAdapter",
      "describeProviderError",
      "resolveChatModelSpec",
      "ProviderModelMap",
      "AIModelTypes",
    ];
    const offenders = consumers.filter((file) => {
      const source = read(file);
      return removed.some((name) => source.includes(name));
    });
    expect(offenders).toEqual([]);
  });

  it('never asks for the removed "structured" profile', () => {
    const offenders = consumers.filter((file) =>
      /profile:\s*["'](default|fast|reasoning|vision|structured)["']/.test(read(file)),
    );
    expect(offenders).toEqual([]);
  });
});

describe("route resolution precedes expensive work", () => {
  // These handlers all run retrieval and/or web search. Resolving after that
  // means an unavailable route is discovered only once the request has paid
  // for context it is about to throw away.
  const handlers = [
    "apps/web/src/app/api/agents/documentQ&A/AIChat/query/route.ts",
    "apps/web/src/app/api/agents/documentQ&A/AIQuery/route.ts",
    "apps/web/src/app/api/agents/documentQ&A/AIQueryRLM/route.ts",
  ];

  it.each(handlers)("%s resolves before retrieval and web search", (file) => {
    const source = read(file);
    const resolveAt = source.indexOf("resolveConfiguredChatModel(");
    expect(resolveAt).toBeGreaterThan(-1);

    for (const expensive of ["performWebSearch(", "getEmbeddings("]) {
      const at = source.indexOf(expensive);
      if (at === -1) continue;
      expect(resolveAt).toBeLessThan(at);
    }
  });
});

describe("authentication precedes chat resolution", () => {
  /**
   * Resolution reports what this deployment can and cannot do, and answers
   * with a 400 when a route is unavailable. Reaching it before `auth()` lets
   * an anonymous caller probe the configuration and turns a request that
   * should be a flat 401 into a 400 about capabilities.
   */
  const handlers = [
    "apps/web/src/app/api/agents/documentQ&A/AIChat/query/route.ts",
    "apps/web/src/app/api/agents/documentQ&A/AIQuery/route.ts",
    "apps/web/src/app/api/agents/documentQ&A/AIQueryRLM/route.ts",
  ];

  it.each(handlers)("%s authenticates first", (file) => {
    const source = read(file);
    const authAt = source.indexOf("await auth()");
    const resolveAt = source.indexOf("resolveConfiguredChatModel(");

    expect(authAt).toBeGreaterThan(-1);
    expect(resolveAt).toBeGreaterThan(-1);
    expect(authAt).toBeLessThan(resolveAt);
  });
});

describe("error handlers do not re-enter chat configuration", () => {
  /**
   * A catch block that resolves again to name the model is fine right up until
   * the thing it is catching *is* a configuration fault — then the second
   * attempt throws the same error out of the handler meant to report it, and
   * the caller gets an opaque 500 instead of the explanation.
   */
  const handlers = [
    ...sourceFiles("apps/web/src/app/api"),
  ].filter((file) => /describeChatError\(/.test(read(file)));

  it("finds the handlers that describe chat errors", () => {
    expect(handlers.length).toBeGreaterThan(0);
  });

  it.each(handlers)("%s resolves the model id before the catch", (file) => {
    const source = read(file);
    for (const match of source.matchAll(/catch\s*\([^)]*\)\s*\{/g)) {
      const block = source.slice(match.index!, match.index! + 1200);
      const nextCatch = block.indexOf("} catch", 1);
      const body = nextCatch === -1 ? block : block.slice(0, nextCatch);
      expect(body).not.toMatch(/resolveConfiguredChatRoute\(|resolveConfiguredChatModel\(/);
    }
  });
});

describe("env.ts stays a light import", () => {
  /**
   * `~/env` is imported by nearly every server module and by next.config.ts at
   * build time. If it reaches the chat SDK stack, every one of those pays the
   * cold-start and bundle cost for a client most of them never construct.
   */
  const WEB_SRC = "apps/web/src";
  const CORE_SRC = "packages/core/src";

  function resolveSpec(spec: string, from: string): string | null {
    let base: string;
    if (spec.startsWith("~/")) base = join(WEB_SRC, spec.slice(2));
    else if (spec === "@launchstack/core") base = join(CORE_SRC, "index");
    else if (spec.startsWith("@launchstack/core/"))
      base = join(CORE_SRC, spec.slice("@launchstack/core/".length));
    else if (spec.startsWith(".")) base = join(from, "..", spec);
    else return null;

    for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
      try {
        read(candidate);
        return candidate;
      } catch {
        // Try the next candidate extension.
      }
    }
    return null;
  }

  function transitiveExternals(entry: string): Set<string> {
    const seen = new Set<string>();
    const externals = new Set<string>();
    const queue = [entry];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const match of read(file).matchAll(/from\s+["']([^"']+)["']/g)) {
        const spec = match[1]!;
        const resolved = resolveSpec(spec, file);
        if (resolved) queue.push(resolved);
        else externals.add(spec);
      }
    }
    return externals;
  }

  it("does not transitively pull the chat SDK stack", () => {
    const externals = transitiveExternals(join(WEB_SRC, "env.ts"));
    const heavy = [
      "@langchain/openai",
      "openai",
      "yaml",
      "zod-to-json-schema",
      "@langchain/core/language_models/chat_models",
    ].filter((dep) => externals.has(dep));

    expect(heavy).toEqual([]);
  });
});
