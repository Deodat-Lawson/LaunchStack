/**
 * Conversations that assistants (Claude, ChatGPT, Gemini) save into a
 * workspace through the MCP server's `save_conversation` tool.
 *
 * - `./types` — the contract the MCP tool codes against (stable shapes).
 * - `./validate` — checks the input, with errors a model can act on.
 * - `./render` — the Markdown transcript, its content hash and size limit.
 * - `./save` — first save (a new private source) and re-save (a new version).
 * - `./follow-up` + `./follow-up-model` — the follow-up note, after the response.
 */
export {
    ConversationSaveError,
    type ConversationMessageInput,
    type ConversationSaveErrorCode,
    type SaveConversationInput,
    type SaveConversationResult,
} from "./types";
export { saveAssistantConversation } from "./save";
