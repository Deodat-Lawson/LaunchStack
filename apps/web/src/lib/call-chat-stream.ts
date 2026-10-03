export type CallChatStreamEvent =
    | { type: "delta"; text: string }
    | { type: "done"; text: string; aiModel: string }
    | { type: "error"; message: string };
