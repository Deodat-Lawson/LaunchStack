/**
 * The MCP server's tools, in the order `tools/list` shows them. Each one says
 * which scope and permission it needs; the dispatcher lists and runs only the
 * ones the caller's credential and membership both allow.
 */
import type { McpTool } from "../protocol";
import { fetchTool } from "./fetch";
import { listSourcesTool } from "./list-sources";
import { saveConversationTool } from "./save-conversation";
import { searchTool } from "./search";

export const MCP_TOOLS: readonly McpTool[] = [
    searchTool,
    fetchTool,
    listSourcesTool,
    saveConversationTool,
];
