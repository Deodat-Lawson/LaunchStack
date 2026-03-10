"use client";
import { type Message } from "../page";
import { User, FileText } from "lucide-react";

interface TeacherMessageProps {
  message: Message;
}

export function TeacherMessage({ message }: TeacherMessageProps) {
  const isUser = message.role === "user";

  return (
    <div className={`flex items-start gap-3 ${isUser ? "flex-row-reverse" : ""}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isUser
            ? "bg-gradient-to-br from-blue-500 to-blue-600"
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
      <div className="flex-1 max-w-[280px]">
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? "bg-blue-500 text-white rounded-tr-sm"
              : "bg-gray-100 text-gray-900 rounded-tl-sm"
          }`}
        >
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {message.content}
          </div>
          {message.attachedDocument && (
            <div className="mt-2 pt-2 border-t border-gray-300/20 flex items-center gap-2 text-xs opacity-80">
              <FileText className="w-3 h-3" />
              <span>{message.attachedDocument}</span>
            </div>
          )}
        </div>
        <div
          className={`text-xs mt-1 px-1 ${
            isUser ? "text-right text-gray-500" : "text-gray-500"
          }`}
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
