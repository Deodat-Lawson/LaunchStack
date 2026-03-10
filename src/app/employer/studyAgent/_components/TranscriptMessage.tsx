import type { Message, Document } from "../page";
import { User, Volume2, FileText } from "lucide-react";

interface TranscriptMessageProps {
  message: Message;
  lightMode?: boolean;
  documents?: Document[];
}

export function TranscriptMessage({ message, lightMode = false, documents = [] }: TranscriptMessageProps) {
  const isUser = message.role === "user";
  const attachedDoc = message.attachedDocumentId 
    ? documents.find(d => d.id === message.attachedDocumentId)
    : null;
  const pdfUrl = message.attachedDocumentUrl ?? attachedDoc?.url;

  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? "bg-gradient-to-br from-blue-500 to-blue-600"
            : lightMode
            ? "bg-white/30"
            : "bg-gradient-to-br from-purple-500 to-purple-600"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-white" />
        ) : (
          <span className="text-white text-xs">AI</span>
        )}
      </div>

      {/* Message Content */}
      <div className={`flex-1 ${pdfUrl ? "max-w-full" : "max-w-[280px]"}`}>
        {/* Voice indicator badge */}
        {message.isVoice && (
          <div
            className={`flex items-center gap-1 mb-1 text-xs ${
              isUser ? "justify-end" : "justify-start"
            }`}
          >
            <Volume2 className={`w-3 h-3 ${lightMode ? "text-white/60" : "text-gray-400"}`} />
            <span className={lightMode ? "text-white/70" : "text-gray-500"}>Voice message</span>
          </div>
        )}

        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-blue-500 text-white rounded-tr-sm"
              : lightMode
              ? "bg-white/20 backdrop-blur-md text-white rounded-tl-sm"
              : "bg-gray-100 text-gray-900 rounded-tl-sm"
          }`}
        >
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </div>
          {pdfUrl && (
            <div className={`mt-3 pt-3 ${
              isUser
                ? "border-t border-blue-400/30"
                : lightMode
                ? "border-t border-white/20"
                : "border-t border-gray-300/50"
            }`}>
              <div className={`flex items-center gap-2 text-xs mb-2 ${
                isUser
                  ? "text-blue-100"
                  : lightMode
                  ? "text-white/80"
                  : "text-gray-600"
              }`}>
                <FileText className="w-3 h-3" />
                <span>{message.attachedDocument ?? attachedDoc?.name ?? "PDF"}</span>
              </div>
              <div className="rounded overflow-hidden bg-white/10 border border-white/20">
                <iframe
                  src={`${pdfUrl}#page=1`}
                  className="w-full h-64 border-0"
                  title={message.attachedDocument ?? "PDF Preview"}
                />
              </div>
            </div>
          )}
          {message.attachedDocument && !pdfUrl && (
            <div
              className={`mt-2 pt-2 flex items-center gap-2 text-xs ${
                isUser
                  ? "border-t border-blue-400/30 text-blue-100"
                  : lightMode
                  ? "border-t border-white/20 text-white/80"
                  : "border-t border-gray-300/50 text-gray-600"
              }`}
            >
              <FileText className="w-3 h-3" />
              <span>{message.attachedDocument}</span>
            </div>
          )}
        </div>

        <div
          className={`text-xs mt-1 px-1 ${
            isUser ? "text-right" : ""
          } ${lightMode ? "text-white/60" : "text-gray-500"}`}
        >
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}