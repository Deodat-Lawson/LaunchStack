"use client";

import React, { useState, useEffect, useRef } from 'react';
import dynamic from "next/dynamic";
import { 
  Sparkles, 
  Send, 
  ThumbsUp, 
  ThumbsDown, 
  Plus, 
  Search, 
  ExternalLink,
  Copy,
  Check,
  MessageSquare,
  X
} from 'lucide-react';
import { useAIChatbot, type Message } from '../hooks/useAIChatbot';
import { useAIChat, type SourceReference } from '../hooks/useAIChat';
import { cn } from '~/lib/utils';
import type { AIModelType } from '~/app/api/agents/documentQ&A/services/types';
import { ModelBadge } from './ModelBadge';

const MarkdownMessage = dynamic(
  () => import("~/app/_components/MarkdownMessage"),
  {
    loading: () => (
      <div className="text-sm text-muted-foreground">Rendering response...</div>
    ),
  }
);

interface AgentChatInterfaceProps {
  chatId: string | null;
  userId: string;
  onAIResponse?: (response: string) => void;
  selectedDocTitle?: string | null;
  searchScope: 'document' | 'company';
  selectedDocId?: number | null;
  companyId?: number | null;
  aiStyle?: string;
  aiPersona?: string;
  aiModel?: AIModelType;
  onPageClick?: (page: number) => void;
  onReferencesResolved?: (references: SourceReference[]) => void;
  onCreateChat?: () => Promise<string | null>;
  isDocumentProcessing?: boolean;
}

export const AgentChatInterface: React.FC<AgentChatInterfaceProps> = ({
  chatId,
  userId: _userId,
  onAIResponse,
  selectedDocTitle,
  searchScope,
  selectedDocId,
  companyId,
  aiStyle = 'concise',
  aiPersona = 'general',
  aiModel = 'gpt-5.2',
  onPageClick,
  onReferencesResolved,
  onCreateChat,
  isDocumentProcessing = false,
}) => {
  const { getMessages, sendMessage, voteMessage, error } = useAIChatbot();
  const { sendQuery: sendAIChatQuery, error: aiChatError } = useAIChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enableWebSearch, setEnableWebSearch] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const toolsMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chatId) {
      const loadAndCheckWelcome = async () => {
        const msgs = await getMessages(chatId);
        setMessages(msgs);
        const latestReferencedMessage = [...msgs]
          .reverse()
          .find((msg) =>
            msg.role === "assistant" &&
            typeof msg.content === "object" &&
            msg.content !== null &&
            "references" in msg.content &&
            Array.isArray(msg.content.references) &&
            msg.content.references.length > 0
          );
        if (
          latestReferencedMessage &&
          typeof latestReferencedMessage.content === "object" &&
          latestReferencedMessage.content !== null &&
          "references" in latestReferencedMessage.content &&
          Array.isArray(latestReferencedMessage.content.references)
        ) {
          onReferencesResolved?.(latestReferencedMessage.content.references);
        }
        
        if (msgs.length === 0 && aiPersona === 'learning-coach') {
          sendMessage({
            chatId,
            role: 'assistant',
            content: {
              text: `Hi! I'm your Learning Coach. 👋\n\nI'm here to help you understand and learn from your documents. I'll:\n\n• Break down complex concepts into easy-to-understand explanations\n• Ask you questions to check your understanding\n• Provide examples and analogies to make things clearer\n• Help you connect ideas across different parts of the document\n\nFeel free to ask me anything about ${selectedDocTitle ?? 'your documents'}! I'm here to make learning easier and more engaging for you.`
            },
            messageType: 'text',
          }).then((welcomeMsg) => {
            if (welcomeMsg) {
              setMessages([welcomeMsg]);
            }
          }).catch(console.error);
        }
      };
      void loadAndCheckWelcome();
    } else {
      setMessages([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, aiPersona, selectedDocTitle]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(event.target as Node)) {
        setShowToolsMenu(false);
      }
    };

    if (showToolsMenu) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showToolsMenu]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '48px';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 48), 180)}px`;
    }
  }, [input]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showToolsMenu) {
          setShowToolsMenu(false);
        } else if (input.trim()) {
          setInput('');
          textareaRef.current?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [input, showToolsMenu]);

  const handleCopy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isSubmitting) return;

    const userMessage = input.trim();
    setInput('');
    setIsSubmitting(true);

    let activeChatId = chatId;

    try {
      if (!activeChatId && onCreateChat) {
        activeChatId = await onCreateChat();
      }

      if (!activeChatId) {
        throw new Error("Failed to create chat session");
      }

      const userMsg = await sendMessage({
        chatId: activeChatId,
        role: 'user',
        content: { text: userMessage, context: { searchScope, selectedDocTitle } },
        messageType: 'text',
      });

      if (userMsg) {
        setMessages(prev => [...prev, userMsg]);
      }

      try {
        const conversationContext = messages
          .filter(msg => msg.role === 'user' || msg.role === 'assistant')
          .slice(-6)
          .map(msg => {
            const role = msg.role === 'user' ? 'User' : 'Assistant';
            const content = typeof msg.content === 'string' 
              ? msg.content 
              : (typeof msg.content === 'object' && msg.content !== null && 'text' in msg.content)
                ? (msg.content.text ?? JSON.stringify(msg.content))
                : JSON.stringify(msg.content);
            return `${role}: ${content}`;
          })
          .join('\n\n');

        const aiData = await sendAIChatQuery({
          question: userMessage,
          searchScope,
          style: aiStyle as 'concise' | 'detailed' | 'academic' | 'bullet-points',
          conversationHistory: conversationContext || undefined,
          enableWebSearch: Boolean(enableWebSearch),
          aiPersona: aiPersona as 'general' | 'learning-coach' | 'financial-expert' | 'legal-expert' | 'math-reasoning' | undefined,
          aiModel,
          documentId: searchScope === "document" && selectedDocId ? selectedDocId : undefined,
          companyId: searchScope === "company" && companyId ? companyId : undefined,
        });

        if (!aiData) {
          throw new Error(aiChatError ?? "Failed to get AI response");
        }

        const aiAnswer = aiData.summarizedAnswer ?? "I'm sorry, I couldn't generate a response right now. Could you try rephrasing your question?";
        const references = aiData.references ?? [];
        const pages = aiData.recommendedPages ?? [];
        const webSources = aiData.webSources ?? [];
        if (references.length > 0) {
          onReferencesResolved?.(references);
          const firstPage = references[0]?.page;
          if (typeof firstPage === "number") {
            onPageClick?.(firstPage);
          }
        } else if (pages.length > 0) {
          const firstFallbackPage = pages[0];
          if (typeof firstFallbackPage === "number") {
            onPageClick?.(firstFallbackPage);
          }
        }

        const aiResponse = await sendMessage({
          chatId: activeChatId,
          role: 'assistant',
          content: {
            text: aiAnswer,
            references: references.length > 0 ? references : undefined,
            pages: pages,
            webSources: webSources.length > 0 ? webSources : undefined,
            aiModel: aiData.aiModel as AIModelType | undefined ?? aiModel
          },
          messageType: 'text',
        });

        if (aiResponse) {
          setMessages(prev => [...prev, aiResponse]);
          if (onAIResponse) {
            onAIResponse(aiAnswer);
          }
        }
      } catch (err) {
        console.error('AI service error:', err);
        const errorResponse = await sendMessage({
          chatId: activeChatId,
          role: 'assistant',
          content: { text: 'Sorry, I encountered an error. Please try again.' },
          messageType: 'text',
        });
        if (errorResponse) {
          setMessages(prev => [...prev, errorResponse]);
        }
      }
    } catch (err) {
      console.error('Failed to send message:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVote = async (messageId: string, isUpvoted: boolean) => {
    if (!chatId) return;
    await voteMessage(chatId, messageId, isUpvoted);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">
      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-5 py-5 space-y-5 custom-scrollbar"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="relative mb-5">
              <div className="w-16 h-16 rounded-2xl bg-purple-50 dark:bg-purple-900/20 flex items-center justify-center">
                <MessageSquare className="w-7 h-7 text-purple-400/60 dark:text-purple-500/40" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/25">
                <Sparkles className="w-3.5 h-3.5 text-white" />
              </div>
            </div>
            <h3 className="text-sm font-bold text-foreground mb-1.5">Start a conversation</h3>
            <p className="text-xs text-muted-foreground max-w-xs leading-relaxed">
              Ask me anything about {searchScope === 'document' ? (selectedDocTitle ?? 'your document') : 'all your company documents'}. I&apos;m here to help!
            </p>
            <div className="flex flex-wrap gap-1.5 mt-5 justify-center max-w-sm">
              {[
                "Summarize the key points",
                "What are the main takeaways?",
                "Explain the technical terms"
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setInput(prompt)}
                  className="px-3 py-1.5 text-xs font-medium text-muted-foreground bg-muted rounded-full hover:bg-purple-50 dark:hover:bg-purple-900/20 hover:text-purple-600 dark:hover:text-purple-400 transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const displayText =
              typeof msg.content === 'string'
                ? msg.content
                : (typeof msg.content === 'object' && msg.content !== null && 'text' in msg.content)
                  ? msg.content.text ?? JSON.stringify(msg.content)
                  : JSON.stringify(msg.content);

            return (
              <div
                key={msg.id}
                className={cn(
                  'flex gap-2.5',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {/* AI Avatar */}
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
                    <Sparkles className="w-3.5 h-3.5 text-white" />
                  </div>
                )}

                <div className={cn(
                  'max-w-[78%] rounded-xl transition-all',
                  msg.role === 'user'
                    ? 'bg-purple-600 text-white px-4 py-2.5 shadow-sm shadow-purple-500/20'
                    : 'bg-card border border-border px-4 py-3 shadow-sm'
                )}>
                  {msg.role === 'assistant' ? (
                    <MarkdownMessage
                      content={displayText}
                      className="text-sm leading-relaxed text-foreground prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2"
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{displayText}</p>
                  )}

                  {msg.role === 'assistant' && typeof msg.content === 'object' && msg.content !== null && (
                    <>
                      {/* Source References */}
                      {'references' in msg.content && Array.isArray(msg.content.references) && msg.content.references.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] mb-2">
                            Page References
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.content.references.map((reference: SourceReference, idx: number) => (
                              <button
                                key={`${msg.id}-reference-${idx}`}
                                onClick={() => {
                                  onReferencesResolved?.([reference]);
                                  if (typeof reference.page === "number") {
                                    onPageClick?.(reference.page);
                                  }
                                }}
                                className="inline-flex items-center bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2.5 py-1 rounded-md text-xs font-semibold hover:bg-purple-200 dark:hover:bg-purple-800/50 transition-all"
                              >
                                {reference.page ? `Page ${reference.page}` : "Highlight Source"}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Legacy page references fallback */}
                      {(!('references' in msg.content) || !Array.isArray(msg.content.references) || msg.content.references.length === 0) &&
                        'pages' in msg.content && Array.isArray(msg.content.pages) && msg.content.pages.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] mb-2">
                            Referenced Pages
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.content.pages.map((page: number, idx: number) => (
                              <button
                                key={`${msg.id}-page-${page}-${idx}`}
                                onClick={() => onPageClick?.(page)}
                                className="inline-flex items-center bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 px-2.5 py-1 rounded-md text-xs font-semibold hover:bg-purple-200 dark:hover:bg-purple-800/50 transition-all"
                              >
                                Page {page}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Web Sources */}
                      {'webSources' in msg.content && Array.isArray(msg.content.webSources) && msg.content.webSources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-border">
                          <p className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em] mb-2">
                            Web Sources
                          </p>
                          <div className="space-y-1.5">
                            {msg.content.webSources.map((source: { title: string; url: string; snippet: string }, idx: number) => (
                              <a
                                key={`${msg.id}-source-${idx}`}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors group border border-blue-100 dark:border-blue-900/50"
                              >
                                <div className="flex items-start gap-2">
                                  <ExternalLink className="w-3 h-3 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 truncate">
                                      {source.title}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                      {source.snippet}
                                    </p>
                                  </div>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Model Badge & Actions */}
                      <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border">
                        <ModelBadge model={msg.aiModel ?? (typeof msg.content === 'object' && msg.content !== null && 'aiModel' in msg.content ? msg.content.aiModel : undefined)} />
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => handleCopy(displayText, msg.id)}
                            className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-all"
                            title="Copy response"
                          >
                            {copiedId === msg.id
                              ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                              : <Copy className="w-3.5 h-3.5" />
                            }
                          </button>
                          <button
                            onClick={() => handleVote(msg.id, true)}
                            className="p-1.5 rounded-md hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-all"
                            title="Helpful"
                          >
                            <ThumbsUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleVote(msg.id, false)}
                            className="p-1.5 rounded-md hover:bg-red-50 dark:hover:bg-red-900/20 text-muted-foreground hover:text-red-600 dark:hover:text-red-400 transition-all"
                            title="Not helpful"
                          >
                            <ThumbsDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* User Avatar */}
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-muted flex items-center justify-center">
                    <span className="text-[10px] font-bold text-muted-foreground">You</span>
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Typing Indicator */}
        {isSubmitting && (
          <div className="flex gap-2.5 justify-start">
            <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-purple-600 flex items-center justify-center shadow-sm shadow-purple-500/20">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            <div className="bg-card border border-border rounded-xl px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-muted-foreground font-medium">Thinking...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-border p-3.5 bg-background/90 backdrop-blur-sm">
        {error && (
          <div className="mb-2.5 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60 rounded-lg flex items-center gap-2">
            <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full">
          <div className="rounded-xl border border-border bg-muted/30 transition-colors focus-within:border-purple-400/60 dark:focus-within:border-purple-600/60 focus-within:ring-2 focus-within:ring-purple-500/10">
            <div className="flex items-end gap-2 p-2">
              {/* Tools Button */}
              <div className="relative flex-shrink-0" ref={toolsMenuRef}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowToolsMenu(!showToolsMenu);
                  }}
                  className={cn(
                    "w-9 h-9 flex items-center justify-center rounded-lg transition-all border",
                    showToolsMenu || enableWebSearch
                      ? "bg-purple-600 text-white border-purple-600 shadow-sm shadow-purple-500/20"
                      : "bg-background text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                  )}
                  title="Tools"
                  aria-label="Open tools menu"
                >
                  <Plus className={cn("w-4 h-4 transition-transform", showToolsMenu && "rotate-45")} />
                </button>

                {/* Tools Menu */}
                {showToolsMenu && (
                  <div className="absolute bottom-full left-0 mb-2 w-60 bg-card rounded-xl shadow-xl border border-border overflow-hidden z-50 animate-in slide-in-from-bottom-2 fade-in duration-150">
                    <div className="px-3 py-2 border-b border-border flex items-center justify-between">
                      <span className="text-[9px] font-black text-muted-foreground uppercase tracking-[0.15em]">Tools</span>
                      <button
                        onClick={() => setShowToolsMenu(false)}
                        className="w-5 h-5 rounded flex items-center justify-center hover:bg-muted text-muted-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setEnableWebSearch(!enableWebSearch);
                        setShowToolsMenu(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/60 transition-colors",
                        enableWebSearch && "bg-purple-50 dark:bg-purple-900/20"
                      )}
                    >
                      <div className={cn(
                        "w-7 h-7 rounded-lg flex items-center justify-center",
                        enableWebSearch
                          ? "bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400"
                          : "bg-muted text-muted-foreground"
                      )}>
                        <Search className="w-3.5 h-3.5" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className={cn(
                          "text-xs font-semibold",
                          enableWebSearch ? "text-purple-600 dark:text-purple-400" : "text-foreground"
                        )}>
                          Web Search
                        </p>
                        <p className="text-[10px] text-muted-foreground">Search the web for more info</p>
                      </div>
                      {enableWebSearch && (
                        <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Input Field */}
              <div className="flex-1 min-w-0">
                {enableWebSearch && (
                  <div className="mb-1.5 inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 rounded-md">
                    <Search className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                    <span className="text-[9px] font-black text-purple-600 dark:text-purple-400 uppercase tracking-[0.15em]">Web search on</span>
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    e.stopPropagation();
                    setInput(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSubmit(e);
                    }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  placeholder={`Ask about ${searchScope === 'document' ? (selectedDocTitle ?? 'your document') : 'all company documents'}...`}
                  className="w-full bg-transparent text-foreground placeholder:text-muted-foreground/60 px-1 py-2 text-sm focus:outline-none resize-none min-h-[48px] max-h-[180px] leading-relaxed"
                  rows={1}
                  disabled={isSubmitting || isDocumentProcessing}
                />
                <div className="flex items-center justify-between pb-1 px-1">
                  <span className="text-[10px] text-muted-foreground">
                    Enter to send · Shift+Enter for new line
                  </span>
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">
                    {searchScope === 'document' ? 'Document mode' : 'Company mode'}
                  </span>
                </div>
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!input.trim() || isSubmitting || isDocumentProcessing}
                className={cn(
                  "h-9 min-w-9 px-3 rounded-lg flex items-center justify-center gap-1.5 font-semibold text-sm transition-all flex-shrink-0",
                  !input.trim() || isSubmitting
                    ? "bg-muted text-muted-foreground cursor-not-allowed border border-border"
                    : "bg-purple-600 text-white hover:bg-purple-700 shadow-sm shadow-purple-500/20 active:scale-95"
                )}
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
                <span className="hidden md:inline text-xs">Send</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: hsl(var(--border)); border-radius: 10px; }
      `}</style>
    </div>
  );
};
