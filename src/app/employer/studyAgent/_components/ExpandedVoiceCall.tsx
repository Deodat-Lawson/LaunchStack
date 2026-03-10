import { useRef, useEffect } from "react";
import { type Message, type Document } from "../page";
import { Button } from "./ui/button";
import { X } from "lucide-react";
import { TranscriptMessage } from "./TranscriptMessage";

interface ExpandedVoiceCallProps {
  messages: Message[];
  isBuddy?: boolean;
  onClose: () => void;
  documents?: Document[];
}

export function ExpandedVoiceCall({ messages, isBuddy = false, onClose, documents = [] }: ExpandedVoiceCallProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl h-[600px] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-4 border-b flex items-center justify-between ${
          isBuddy ? "bg-blue-50" : "bg-purple-50"
        }`}>
          <div>
            <h3 className="text-lg">Conversation Transcript</h3>
            <p className="text-sm text-gray-600">
              {isBuddy ? "Study Buddy Session" : "Teaching Session"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-8 w-8 p-0"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <p>No messages yet</p>
              <p className="text-sm mt-1">Start the conversation by speaking</p>
            </div>
          ) : (
            messages.map((message) => (
              <TranscriptMessage 
                key={message.id} 
                message={message} 
                documents={documents}
              />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}

