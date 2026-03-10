"use client";

import { useState, useRef, useEffect } from "react";
import { Send, Sparkles } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { AIChatbotSelector, type AIModel } from "./AIChatbotSelector";
import { useAIQuery } from "~/app/employer/documents/hooks/useAIQuery";
import type { AIModelType } from "~/app/api/agents/documentQ&A/services/types";
import { ModelBadge } from "~/app/employer/documents/components/ModelBadge";

interface AIMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  timestamp: Date;
  model: AIModelType;
}

interface AIQueryChatProps {
  isBuddy?: boolean;
  isDark?: boolean;
  selectedDocumentId?: string | null;
}

export function AIQueryChat({ isBuddy = false, isDark = false, selectedDocumentId }: AIQueryChatProps) {
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState("");
  // Default to the first model in AIChatbotSelector (gpt-5.2)
  const [selectedModel, setSelectedModel] = useState<AIModel>("gpt-5.2");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sendQuery, loading: isTyping, error } = useAIQuery();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isTyping) {
      if (!selectedDocumentId) {
        const errorMessage = "Please select a document first to ask questions about it.";
        const errorAiMessage: AIMessage = {
          id: Date.now().toString(),
          role: "ai",
          content: errorMessage,
          timestamp: new Date(),
          model: selectedModel as AIModelType,
        };
        setMessages((prev) => [...prev, errorAiMessage]);
        return;
      }

      const userMessage: AIMessage = {
        id: Date.now().toString(),
        role: "user",
        content: input.trim(),
        timestamp: new Date(),
        model: selectedModel as AIModelType,
      };
      
      const currentInput = input.trim();
      const currentMessages = [...messages, userMessage];
      
      setMessages(currentMessages);
      setInput("");
      
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }

      // Build conversation history string for context
      const conversationHistory = currentMessages
        .slice(-10)
        .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
        .join("\n");

      // Convert documentId string to number
      const documentIdNum = parseInt(selectedDocumentId, 10);
      if (isNaN(documentIdNum)) {
        const errorMessage = "Invalid document ID";
        const errorAiMessage: AIMessage = {
          id: (Date.now() + 1).toString(),
          role: "ai",
          content: `I'm sorry, I encountered an error: ${errorMessage}. Please try again.`,
          timestamp: new Date(),
          model: selectedModel as AIModelType,
        };
        setMessages((prev) => [...prev, errorAiMessage]);
        return;
      }

      const response = await sendQuery({
        documentId: documentIdNum,
        question: currentInput,
        aiModel: selectedModel as AIModelType,
        style: "concise",
        enableWebSearch: false,
        conversationHistory: conversationHistory || undefined,
      });

      if (response) {
        const aiMessage: AIMessage = {
          id: (Date.now() + 1).toString(),
          role: "ai",
          content: response.summarizedAnswer ?? "I apologize, but I couldn't generate a response.",
          timestamp: new Date(),
          model: response.aiModel as AIModelType,
        };
        setMessages((prev) => [...prev, aiMessage]);
      } else if (error) {
        // Add error message to chat
        const errorAiMessage: AIMessage = {
          id: (Date.now() + 1).toString(),
          role: "ai",
          content: `I'm sorry, I encountered an error: ${error}. Please try again.`,
          timestamp: new Date(),
          model: selectedModel as AIModelType,
        };
        setMessages((prev) => [...prev, errorAiMessage]);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
  };

  const themeColor = isBuddy ? "blue" : "purple";
  
  return (
    <div className={`flex flex-col h-full ${isDark ? 'bg-gray-900' : 'bg-white'}`}>
      {/* Header with Model Selector */}
      <div className={`p-4 border-b space-y-3 ${isDark ? 'border-gray-700 bg-gray-800' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center gap-2">
          <Sparkles className={`w-4 h-4 ${isDark ? 'text-yellow-400' : `text-${themeColor}-600`}`} />
          <div>
            <h4 className={`text-sm ${isDark ? 'text-white' : 'text-gray-900'}`}>AI Query Assistant</h4>
            <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              Separate from voice chat
            </p>
          </div>
        </div>
        <div>
          <label className={`text-xs mb-1.5 block ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
            AI Model
          </label>
          <AIChatbotSelector 
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
          />
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className={`text-center py-12 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            <Sparkles className={`w-12 h-12 mx-auto mb-3 opacity-50 ${isDark ? 'text-gray-600' : ''}`} />
            <p className="text-sm">Ask me anything about your studies</p>
            <p className="text-xs mt-1">
              {selectedDocumentId 
                ? "This is a separate AI assistant for quick queries about the selected document"
                : "Please select a document first to ask questions about it"}
            </p>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-lg p-3 ${
                    message.role === "user"
                      ? `${isBuddy ? 'bg-blue-600' : 'bg-purple-600'} text-white`
                      : isDark
                      ? 'bg-gray-800 text-gray-100 border border-gray-700'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  <div className="flex items-center justify-between gap-2 mt-1">
                    <p
                      className={`text-xs ${
                        message.role === "user"
                          ? "text-white/70"
                          : isDark
                          ? "text-gray-500"
                          : "text-gray-500"
                      }`}
                    >
                      {message.timestamp.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                    {message.role === "ai" && (
                      <ModelBadge model={message.model} />
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className={`rounded-lg p-3 ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-gray-100'}`}>
                  <div className="flex gap-1">
                    <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-400'} animate-bounce`} style={{ animationDelay: '0ms' }} />
                    <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-400'} animate-bounce`} style={{ animationDelay: '150ms' }} />
                    <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-gray-600' : 'bg-gray-400'} animate-bounce`} style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className={`border-t p-4 ${
        isDark 
          ? 'border-gray-700 bg-gray-800' 
          : isBuddy 
          ? 'bg-blue-50/50 border-gray-200' 
          : 'bg-purple-50/50 border-gray-200'
      }`}>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={selectedDocumentId ? "Ask a question... (Shift+Enter for new line)" : "Select a document first to ask questions"}
            disabled={!selectedDocumentId}
            className={`min-h-[44px] max-h-[120px] resize-none ${
              isDark ? 'bg-gray-900 border-gray-700 text-white placeholder:text-gray-500' : ''
            } ${!selectedDocumentId ? 'opacity-50 cursor-not-allowed' : ''}`}
            rows={1}
          />
          <Button
            type="submit"
            size="sm"
            disabled={!input.trim() || isTyping || !selectedDocumentId}
            className={`self-end h-11 px-4 ${
              isBuddy
                ? "bg-blue-600 hover:bg-blue-700"
                : "bg-purple-600 hover:bg-purple-700"
            } ${!selectedDocumentId ? 'opacity-50 cursor-not-allowed' : ''}`}
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
        <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}

