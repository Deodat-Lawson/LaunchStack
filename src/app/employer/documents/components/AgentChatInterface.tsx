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
      textareaRef.current.style.height = '52px';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = `${Math.min(Math.max(scrollHeight, 52), 180)}px`;
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
            webSources: webSources.length > 0 ? webSources : undefined
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
    <div className="flex flex-col h-full overflow-hidden">
      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto px-6 py-6 space-y-6"
        role="log"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/30 dark:to-indigo-900/30 flex items-center justify-center">
                <MessageSquare className="w-9 h-9 text-violet-500/60 dark:text-violet-400/50" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/25">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
            </div>
            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-2">
              Start a conversation
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 max-w-sm leading-relaxed">
              Ask me anything about {searchScope === 'document' ? (selectedDocTitle ?? 'your document') : 'all your company documents'}. I&apos;m here to help!
            </p>
            
            {/* Quick prompts */}
            <div className="flex flex-wrap gap-2 mt-6 justify-center max-w-md">
              {[
                "Summarize the key points",
                "What are the main takeaways?",
                "Explain the technical terms"
              ].map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => setInput(prompt)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 rounded-full hover:bg-violet-100 dark:hover:bg-violet-900/30 hover:text-violet-600 dark:hover:text-violet-400 transition-all"
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
                  'flex gap-3',
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {/* AI Avatar */}
                {msg.role === 'assistant' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/20">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}

                <div
                  className={cn(
                    'max-w-[75%] rounded-2xl transition-all',
                    msg.role === 'user'
                      ? 'bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-4 py-3 shadow-lg shadow-violet-500/20'
                      : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-4 py-3 shadow-sm'
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <MarkdownMessage
                      content={displayText}
                      className="text-sm leading-relaxed text-slate-700 dark:text-slate-200 prose prose-sm dark:prose-invert max-w-none prose-p:my-2 prose-headings:mt-4 prose-headings:mb-2"
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">
                      {displayText}
                    </p>
                  )}
                  
                  {msg.role === 'assistant' && typeof msg.content === 'object' && msg.content !== null && (
                    <>
                      {/* Source References */}
                      {'references' in msg.content && Array.isArray(msg.content.references) && msg.content.references.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
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
                                className="inline-flex items-center bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-violet-200 dark:hover:bg-violet-800/50 transition-all"
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
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                            Referenced Pages
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {msg.content.pages.map((page: number, idx: number) => (
                              <button
                                key={`${msg.id}-page-${page}-${idx}`}
                                onClick={() => onPageClick?.(page)}
                                className="inline-flex items-center bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 px-2.5 py-1 rounded-lg text-xs font-semibold hover:bg-violet-200 dark:hover:bg-violet-800/50 transition-all"
                              >
                                Page {page}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Web Sources */}
                      {'webSources' in msg.content && Array.isArray(msg.content.webSources) && msg.content.webSources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                          <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                            Web Sources
                          </p>
                          <div className="space-y-2">
                            {msg.content.webSources.map((source: { title: string; url: string; snippet: string }, idx: number) => (
                              <a
                                key={`${msg.id}-source-${idx}`}
                                href={source.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block p-2.5 bg-blue-50 dark:bg-blue-950/30 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors group border border-blue-100 dark:border-blue-900/50"
                              >
                                <div className="flex items-start gap-2">
                                  <ExternalLink className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 truncate">
                                      {source.title}
                                    </p>
                                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">
                                      {source.snippet}
                                    </p>
                                  </div>
                                </div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex items-center gap-1 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                        <button
                          onClick={() => handleCopy(displayText, msg.id)}
                          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-all"
                          title="Copy response"
                        >
                          {copiedId === msg.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => handleVote(msg.id, true)}
                          className="p-1.5 rounded-lg hover:bg-emerald-50 dark:hover:bg-emerald-900/20 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-all"
                          title="Helpful"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleVote(msg.id, false)}
                          className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-all"
                          title="Not helpful"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>

                {/* User Avatar placeholder for alignment */}
                {msg.role === 'user' && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center shadow-md">
                    <span className="text-xs font-bold text-white">You</span>
                  </div>
                )}
              </div>
            );
          })
        )}
        
        {/* Typing Indicator */}
        {isSubmitting && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md shadow-violet-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl px-4 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Thinking...</span>
              </div>
            </div>
          </div>
        )}
        
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t border-slate-200/60 dark:border-slate-800/60 p-4 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md">
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg flex items-center gap-2">
            <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full">
          <div className="rounded-2xl border border-slate-200/80 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-sm transition-colors focus-within:border-violet-400/70 dark:focus-within:border-violet-600/70 focus-within:ring-4 focus-within:ring-violet-500/10">
            <div className="flex items-end gap-2 p-2 sm:p-3">
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
                    "w-10 h-10 sm:w-11 sm:h-11 flex items-center justify-center rounded-xl transition-all border",
                    showToolsMenu || enableWebSearch
                      ? "bg-violet-600 text-white border-violet-600 shadow-md shadow-violet-500/25"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-700 dark:hover:text-slate-300"
                  )}
                  title="Tools"
                  aria-label="Open tools menu"
                >
                  <Plus className={cn("w-5 h-5 transition-transform", showToolsMenu && "rotate-45")} />
                </button>
                
                {/* Tools Menu */}
                {showToolsMenu && (
                  <div className="absolute bottom-full left-0 mb-3 w-64 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden z-50 animate-in slide-in-from-bottom-2 fade-in duration-200">
                    <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tools</span>
                      <button 
                        onClick={() => setShowToolsMenu(false)}
                        className="w-5 h-5 rounded flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400"
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
                        "w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors",
                        enableWebSearch && "bg-violet-50 dark:bg-violet-900/20"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        enableWebSearch 
                          ? "bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400" 
                          : "bg-slate-100 dark:bg-slate-700 text-slate-500"
                      )}>
                        <Search className="w-4 h-4" />
                      </div>
                      <div className="flex-1 text-left">
                        <p className={cn(
                          "text-sm font-semibold",
                          enableWebSearch ? "text-violet-600 dark:text-violet-400" : "text-slate-700 dark:text-slate-300"
                        )}>
                          Web Search
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Search the web for more info
                        </p>
                      </div>
                      {enableWebSearch && (
                        <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                      )}
                    </button>
                  </div>
                )}
              </div>

              {/* Input Field */}
              <div className="flex-1 min-w-0">
                {enableWebSearch && (
                  <div className="mb-2 inline-flex items-center gap-1.5 px-2 py-1 bg-violet-100 dark:bg-violet-900/30 rounded-md">
                    <Search className="w-3 h-3 text-violet-600 dark:text-violet-400" />
                    <span className="text-[10px] font-bold text-violet-600 dark:text-violet-400 uppercase tracking-wider">Web search on</span>
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
                  className="w-full bg-transparent text-slate-700 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 px-2 py-2.5 text-sm focus:outline-none resize-none min-h-[52px] max-h-[180px] leading-relaxed"
                  rows={1}
                  disabled={isSubmitting}
                />
                <div className="flex items-center justify-between px-2 pb-1">
                  <span className="text-[11px] text-slate-400 dark:text-slate-500">
                    Enter to send, Shift+Enter for new line
                  </span>
                  <span className="text-[11px] text-slate-400 dark:text-slate-500 hidden sm:inline">
                    {searchScope === 'document' ? 'Document mode' : 'Company mode'}
                  </span>
                </div>
              </div>

              {/* Send Button */}
              <button
                type="submit"
                disabled={!input.trim() || isSubmitting}
                className={cn(
                  "h-10 sm:h-11 min-w-10 sm:min-w-11 px-3 sm:px-4 rounded-xl flex items-center justify-center gap-1.5 font-semibold text-sm transition-all",
                  !input.trim() || isSubmitting
                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed border border-slate-200 dark:border-slate-700"
                    : "bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 shadow-md shadow-violet-500/25 active:scale-95"
                )}
                aria-label="Send message"
              >
                <Send className="w-4 h-4" />
                <span className="hidden md:inline">Send</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
