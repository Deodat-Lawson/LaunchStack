/**
 * The `instructions` the MCP server sends in its `initialize` result. Clients
 * (Claude, ChatGPT, Gemini) add it to the model's context, so it is written
 * for the model: what LaunchStack is, when to reach for which tool, how to
 * cite, and the one rule that matters most — never save a conversation the
 * person did not ask to save.
 */
export const MCP_INSTRUCTIONS = `LaunchStack is this person's company workspace: the documents their team has uploaded, written or connected (plans, specs, research, contracts, meeting notes, saved assistant conversations), organised in folders. Every tool acts as this person, in one workspace, and only ever sees what they are allowed to open there.

Reading the workspace
- Use \`search\` whenever the answer may be in the company's own material: its product, customers, plans, decisions, numbers, people or past conversations, or when the person mentions LaunchStack, "our docs" or a document by name. Write the query as a short description of what you need. If nothing useful comes back, try once more with different wording before saying the workspace has nothing on it.
- \`search\` returns one result per document with a snippet of the best passages. When the snippet is not enough to answer, call \`fetch\` with that result's \`id\` to read the document's full text.
- Use \`list_sources\` to browse: when the person asks what is in the workspace or in a folder. Use \`search\`, not \`list_sources\`, to answer questions about content.
- Cite what you use: name the document and give its \`url\` next to the statement it supports. Keep workspace facts distinct from your general knowledge, and say plainly when the workspace does not cover something.

Saving conversations
- Call \`save_conversation\` only when the person asks you to save, sync or log this conversation to LaunchStack, or has told you earlier to do it automatically. Never save on your own initiative.
- Send the whole conversation so far: every user and assistant turn, verbatim and in order (no summaries, no tool output), with a short descriptive title.
- The result gives a \`conversationId\`. When you save the same chat again later, pass that \`conversationId\` so LaunchStack updates the saved conversation instead of creating a duplicate.`;
