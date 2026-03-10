import { type Message, type Document } from "../../types";

export interface VoiceChatProps {
    messages: Message[];
    onSendMessage: (content: string) => void;
    onEndCall?: () => void;
    isBuddy?: boolean;
    documents?: Document[];
    avatarUrl?: string;
  }
  
export type CallState = "connected" | "listening" | "speaking" | "muted";