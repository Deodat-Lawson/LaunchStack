/**
 * LLM → Adeu Tool-Calling Integration Test
 *
 * Spins up a real LLM (gpt-4o via LangChain), gives it the Adeu
 * read_docx + edit_document tools, points it at the SAFE template,
 * and asks it to propose edits. The LLM decides which tools to call.
 *
 * Prerequisites:
 *   - OPENAI_API_KEY in .env
 *   - ADEU_SERVICE_URL pointing to a running sidecar (http://localhost:8000)
 *   - The sidecar must be running: cd sidecar && uvicorn app.main:app --port 8000
 *     (or use the lightweight venv: /tmp/sidecar-test-venv/bin/uvicorn ...)
 *
 * Run:
 *   npx tsx scripts/test-adeu-llm-loop.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { ChatOpenAI } from "@langchain/openai";
import {
    HumanMessage,
    AIMessage,
    ToolMessage,
    type BaseMessage,
} from "@langchain/core/messages";
import { readDocx, applyEditsAsMarkdown, processDocumentBatch } from "~/lib/adeu/client";
import type { DocumentEdit } from "~/lib/adeu/types";

const OUTPUT_DIR = path.join(process.cwd(), "test-output");


// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
const LOG_FILE = path.join(process.cwd(), "adeu-llm-test.log");
let logBuffer = "";

function log(label: string, data: unknown) {
    const ts = new Date().toISOString();
    const entry = `[${ts}] ${label}\n${typeof data === "string" ? data : JSON.stringify(data, null, 2)}\n${"─".repeat(80)}\n`;
    logBuffer += entry;
    console.log(`${label}:`, typeof data === "string" ? data.slice(0, 200) : data);
}

function flushLog() {
    fs.writeFileSync(LOG_FILE, logBuffer, "utf-8");
    console.log(`\n📄 Full log written to ${LOG_FILE}`);
}

// ---------------------------------------------------------------------------
// Tool definitions — these are what the LLM sees and decides to call
// ---------------------------------------------------------------------------

// Keep the DOCX buffer in memory so tools can reference it
let docxBuffer: Buffer | null = null;

const readDocxTool = tool(
    async ({ clean_view }: { clean_view: boolean }) => {
        if (!docxBuffer) return "Error: no document loaded";
        log("TOOL CALL → read_docx", { clean_view });
        const result = await readDocx(docxBuffer, { cleanView: clean_view });
        log("TOOL RESULT ← read_docx", { textLength: result.text.length, filename: result.filename });
        return result.text;
    },
    {
        name: "read_docx",
        description:
            "Extract text content from the loaded DOCX document. " +
            "Set clean_view=true to see the accepted-state text (no markup), " +
            "or clean_view=false to see raw text with CriticMarkup annotations.",
        schema: z.object({
            clean_view: z
                .boolean()
                .describe("If true, return clean text without markup. If false, include CriticMarkup."),
        }),
    }
);

const editDocumentTool = tool(
    async ({
        edits,
        highlight_only,
    }: {
        edits: { target_text: string; new_text: string; comment?: string }[];
        highlight_only: boolean;
    }) => {
        if (!docxBuffer) return "Error: no document loaded";
        log("TOOL CALL → edit_document", { editCount: edits.length, highlight_only, edits });

        const adeuEdits: DocumentEdit[] = edits.map((e) => ({
            target_text: e.target_text,
            new_text: e.new_text,
            comment: e.comment,
        }));

        const result = await applyEditsAsMarkdown(docxBuffer, {
            edits: adeuEdits,
            highlight_only,
            include_index: true,
        });

        log("TOOL RESULT ← edit_document", { markdownLength: result.markdown.length });
        return result.markdown;
    },
    {
        name: "edit_document",
        description:
            "Propose edits to the loaded DOCX document. Returns a CriticMarkup-annotated " +
            "markdown preview showing what would change. Each edit finds target_text in the " +
            "document and replaces it with new_text. Optionally add a comment explaining the change. " +
            "Set highlight_only=true to just highlight target text without replacing.",
        schema: z.object({
            edits: z
                .array(
                    z.object({
                        target_text: z.string().describe("Exact text to find in the document"),
                        new_text: z.string().describe("Replacement text"),
                        comment: z.string().optional().describe("Explanation for this edit"),
                    })
                )
                .describe("List of edits to apply"),
            highlight_only: z
                .boolean()
                .describe("If true, only highlight target text without replacing"),
        }),
    }
);

const applyEditsTool = tool(
    async ({
        author_name,
        edits,
    }: {
        author_name: string;
        edits: { target_text: string; new_text: string; comment?: string }[];
    }) => {
        if (!docxBuffer) return "Error: no document loaded";
        log("TOOL CALL → apply_edits", { author_name, editCount: edits.length, edits });

        const adeuEdits: DocumentEdit[] = edits.map((e) => ({
            target_text: e.target_text,
            new_text: e.new_text,
            comment: e.comment,
        }));

        try {
            const { summary, file } = await processDocumentBatch(docxBuffer, {
                author_name,
                edits: adeuEdits,
            });

            // Write the modified DOCX to disk
            if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
            const outPath = path.join(OUTPUT_DIR, `safe-modified-${Date.now()}.docx`);
            const arrayBuf = await file.arrayBuffer();
            fs.writeFileSync(outPath, Buffer.from(arrayBuf));

            log("TOOL RESULT ← apply_edits", { summary, outputPath: outPath });
            return JSON.stringify({
                message: `Modified DOCX saved to ${outPath}`,
                summary,
            });
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            log("TOOL RESULT ← apply_edits (error)", detail);
            return JSON.stringify({
                error: true,
                detail,
                hint: "If target_text matches multiple places, use a longer unique snippet as target_text.",
            });
        }
    },
    {
        name: "apply_edits",
        description:
            "Apply edits to the DOCX document and save the modified file with tracked changes. " +
            "This produces an actual modified .docx file (unlike edit_document which only previews). " +
            "The edits appear as Track Changes in the output document. " +
            "Call this AFTER previewing edits with edit_document to commit them.",
        schema: z.object({
            author_name: z.string().describe("Name of the author making the edits (appears in Track Changes)"),
            edits: z
                .array(
                    z.object({
                        target_text: z.string().describe("Exact text to find in the document"),
                        new_text: z.string().describe("Replacement text"),
                        comment: z.string().optional().describe("Comment bubble text for this edit"),
                    })
                )
                .describe("List of edits to apply as tracked changes"),
        }),
    }
);

const tools = [readDocxTool, editDocumentTool, applyEditsTool];

// ---------------------------------------------------------------------------
// Main: LLM agent loop
// ---------------------------------------------------------------------------
async function main() {
    // 1. Load the SAFE template
    const templatePath = path.join(
        process.cwd(),
        "public/templates/safe-template.docx"
    );
    if (!fs.existsSync(templatePath)) {
        console.error(`❌ Template not found at ${templatePath}`);
        process.exit(1);
    }
    docxBuffer = fs.readFileSync(templatePath);
    log("SETUP", `Loaded SAFE template (${docxBuffer.length} bytes)`);

    // 2. Create the LLM with tools bound
    const llm = new ChatOpenAI({
        openAIApiKey: process.env.OPENAI_API_KEY,
        modelName: "gpt-4o",
        temperature: 0.3,
    }).bindTools(tools);

    // 3. Seed the conversation — the LLM must decide to call tools itself
    const systemPrompt =
        "You are a contract review assistant. You have access to tools that let you " +
        "read, preview edits, and apply edits to DOCX documents. A SAFE (Simple Agreement " +
        "for Future Equity) template has been loaded.\n\n" +
        "Your task:\n" +
        "1. First, read the document to understand its contents.\n" +
        "2. Then, preview 3 specific text edits that fill in placeholder values " +
        "(like {company_name}, {investor_name}, {valuation_cap}, etc.) with " +
        "realistic sample values. Include a comment on each edit explaining why.\n" +
        "3. Finally, apply those same edits using apply_edits to produce the " +
        "modified DOCX file with tracked changes.\n\n" +
        "IMPORTANT: Each target_text must match EXACTLY ONE location in the document. " +
        "If a placeholder like {company_name} appears multiple times, use a longer " +
        "surrounding snippet that is unique (e.g. 'Company: {company_name}, a' instead " +
        "of just '{company_name}').\n\n" +
        "Use the tools provided. Do NOT fabricate document content — read it first.";

    const messages: BaseMessage[] = [
        new HumanMessage(systemPrompt),
    ];

    log("LLM PROMPT", systemPrompt);

    // 4. Agent loop — let the LLM call tools until it stops
    const MAX_ITERATIONS = 10;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
        log(`ITERATION ${i + 1}`, `Sending ${messages.length} messages to LLM`);

        const response = await llm.invoke(messages);
        messages.push(response);

        log("LLM RESPONSE", {
            content: typeof response.content === "string"
                ? response.content.slice(0, 500)
                : response.content,
            tool_calls: response.tool_calls?.map((tc) => ({
                name: tc.name,
                args: tc.args,
            })),
        });

        // If no tool calls, the LLM is done
        if (!response.tool_calls || response.tool_calls.length === 0) {
            log("DONE", "LLM finished — no more tool calls");
            break;
        }

        // Execute each tool call and feed results back
        for (const toolCall of response.tool_calls) {
            log("EXECUTING TOOL", { id: toolCall.id, name: toolCall.name, args: toolCall.args });

            const matchedTool = tools.find((t) => t.name === toolCall.name);
            if (!matchedTool) {
                const errMsg = `Unknown tool: ${toolCall.name}`;
                log("TOOL ERROR", errMsg);
                messages.push(new ToolMessage({ content: errMsg, tool_call_id: toolCall.id! }));
                continue;
            }

            try {
                const result = await (matchedTool.invoke as (args: unknown) => Promise<unknown>)(toolCall.args);
                const resultStr = typeof result === "string" ? result : JSON.stringify(result);
                messages.push(
                    new ToolMessage({ content: resultStr, tool_call_id: toolCall.id! })
                );
            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                log("TOOL ERROR", errMsg);
                messages.push(
                    new ToolMessage({ content: `Error: ${errMsg}`, tool_call_id: toolCall.id! })
                );
            }
        }
    }

    // 5. Print final LLM message
    const lastMsg = messages[messages.length - 1];
    if (lastMsg instanceof AIMessage && typeof lastMsg.content === "string") {
        log("FINAL LLM OUTPUT", lastMsg.content);
    }

    flushLog();
}

main().catch((err) => {
    console.error("Fatal error:", err);
    flushLog();
    process.exit(1);
});
