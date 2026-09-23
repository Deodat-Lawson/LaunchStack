"use client";

import React, { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
    ArrowRight,
    ArrowUp,
    ArrowUpRight,
    BookOpen,
    Check,
    ChevronDown,
    FileText,
    GitBranch,
    History,
    Menu,
    Mic,
    NotebookPen,
    Plus,
    Search,
    Sparkles,
    X,
    Zap,
} from "lucide-react";
import { SIGN_UP_URL } from "~/config/site";
import { LaunchstackMark } from "./LaunchstackLogo";
import {
    SAMPLE_SOURCES,
    SAMPLE_QUESTIONS,
    SAMPLE_DRAFT,
    resolveSampleQuestion,
} from "./workspaceDemoModel";
import s from "../../styles/startup.module.css";
import d from "../../styles/workspaceDemo.module.css";

type View = "chat" | "knowledge" | "notebook";
const SOURCES = SAMPLE_SOURCES;
const sourceIcon = (id: string) =>
    id === "discovery" ? Mic : id === "engineering" ? GitBranch : FileText;

export function StartupDemo() {
    const [view, setView] = useState<View>("chat");
    const [rail, setRail] = useState<"sources" | "history">("sources");
    const [query, setQuery] = useState("");
    const [selected, setSelected] = useState<string[]>(SOURCES.map(s => s.id));
    const [question, setQuestion] = useState<number | null>(0);
    const [prompt, setPrompt] = useState("");
    const [feedback, setFeedback] = useState("");
    const [missing, setMissing] = useState<string[]>([]);
    const [source, setSource] = useState<string | null>(null);
    const [studioOpen, setStudioOpen] = useState(false);
    const [railOpen, setRailOpen] = useState(false);
    const [note, setNote] = useState("");
    const composer = useRef<HTMLTextAreaElement>(null);
    const studioButton = useRef<HTMLButtonElement>(null);
    const studio = useRef<HTMLDivElement>(null);
    const sourceButton = useRef<HTMLButtonElement>(null);
    const closeRailButton = useRef<HTMLButtonElement>(null);
    const sourceDialog = useRef<HTMLDialogElement>(null);
    const current = question === null ? null : SAMPLE_QUESTIONS[question]!;
    const excerpt = SOURCES.find(item => item.id === source);
    const filtered = SOURCES.filter(s => s.title.toLowerCase().includes(query.toLowerCase()));
    const closeSource = () => {
        sourceDialog.current?.close();
        setSource(null);
    };
    useEffect(() => {
        if (source) sourceDialog.current?.showModal();
    }, [source]);
    useEffect(() => {
        if (railOpen) closeRailButton.current?.focus();
    }, [railOpen]);
    useEffect(() => {
        if (!studioOpen) return;
        const close = (event: PointerEvent) => {
            if (!studio.current?.contains(event.target as Node)) setStudioOpen(false);
        };
        document.addEventListener("pointerdown", close);
        return () => document.removeEventListener("pointerdown", close);
    }, [studioOpen]);
    const toggleSource = (id: string) =>
        setSelected(prev => (prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]));
    const selectView = (next: View) => {
        setView(next);
        setStudioOpen(false);
        setRailOpen(false);
    };
    const choosePrompt = (text: string) => {
        setPrompt(text);
        setFeedback("");
        setMissing([]);
        composer.current?.focus();
    };
    const submit = () => {
        if (!prompt.trim()) return;
        const result = resolveSampleQuestion(prompt, selected);
        if (result.kind === "unsupported") {
            setFeedback(
                "This preview answers the sample questions below. Open a workspace to ask your own questions."
            );
            setMissing([]);
            return;
        }
        if (result.kind === "missing") {
            setMissing([...result.missing]);
            setFeedback(
                "This sample answer needs more context. Include the sources below and send again."
            );
            return;
        }
        setQuestion(result.index);
        setPrompt("");
        setFeedback("");
        setMissing([]);
    };
    const openHistory = (index: number) => {
        setQuestion(index);
        setView("chat");
        setRailOpen(false);
        setFeedback("");
        setMissing([]);
        setPrompt("");
    };
    return (
        <section className={d.demo} id="product-demo" aria-label="Interactive sample workspace">
            <div className={d.caption}>
                <span>
                    <span className={d.statusDot} />
                    Sample workspace
                </span>
                <span>Explore Launchstack with Acme’s sample data</span>
            </div>
            <div className={d.frame}>
                {railOpen && (
                    <button
                        className={d.railScrim}
                        aria-label="Dismiss source sidebar"
                        onClick={() => {
                            setRailOpen(false);
                            sourceButton.current?.focus();
                        }}
                    />
                )}
                <aside
                    id="demo-sources"
                    className={`${d.rail} ${railOpen ? d.railOpen : ""}`}
                    aria-label="Demo workspace"
                    onKeyDown={e => {
                        if (e.key === "Escape") {
                            setRailOpen(false);
                            sourceButton.current?.focus();
                        }
                    }}
                >
                    <div className={d.railBrand}>
                        <LaunchstackMark size={22} />
                        <strong>Launchstack</strong>
                        <a href={SIGN_UP_URL} aria-label="Add knowledge to your workspace">
                            <Plus size={15} />
                        </a>
                        <button
                            ref={closeRailButton}
                            className={d.closeRail}
                            aria-label="Close sources"
                            onClick={() => {
                                setRailOpen(false);
                                sourceButton.current?.focus();
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className={d.railTabs} role="group" aria-label="Browse sample workspace">
                        {(["sources", "history"] as const).map(tab => (
                            <button
                                type="button"
                                key={tab}
                                aria-pressed={rail === tab}
                                onClick={() => {
                                    setRail(tab);
                                    setQuery("");
                                }}
                            >
                                {tab === "sources" ? "Sources" : "History"}
                            </button>
                        ))}
                    </div>
                    <label className={d.search}>
                        <Search size={14} aria-hidden="true" />
                        <input
                            name="demo-search"
                            autoComplete="off"
                            aria-label={`Search sample ${rail}`}
                            placeholder={
                                rail === "sources" ? "Search your knowledge" : "Search history"
                            }
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                        />
                    </label>
                    <div className={d.railList}>
                        <div className={d.railLabel}>
                            {rail === "sources" ? "All sources" : "Recent conversations"}
                            <span>
                                {rail === "sources" ? SOURCES.length : SAMPLE_QUESTIONS.length}
                            </span>
                        </div>
                        {rail === "sources"
                            ? filtered.map(item => {
                                  const Icon = sourceIcon(item.id);
                                  return (
                                      <div
                                          key={item.id}
                                          className={`${d.sourceRow} ${selected.includes(item.id) ? d.selectedRow : ""}`}
                                      >
                                          <input
                                              type="checkbox"
                                              aria-label={`Include ${item.title} in context`}
                                              checked={selected.includes(item.id)}
                                              onChange={() => toggleSource(item.id)}
                                          />
                                          <button type="button" onClick={() => setSource(item.id)}>
                                              <Icon size={14} aria-hidden="true" />
                                              <span>
                                                  {item.title}
                                                  <small>{item.detail}</small>
                                              </span>
                                          </button>
                                      </div>
                                  );
                              })
                            : SAMPLE_QUESTIONS.map(
                                  (item, i) =>
                                      item.question.toLowerCase().includes(query.toLowerCase()) && (
                                          <button
                                              type="button"
                                              className={d.historyRow}
                                              key={item.question}
                                              onClick={() => openHistory(i)}
                                          >
                                              <History size={14} aria-hidden="true" />
                                              {item.question}
                                          </button>
                                      )
                              )}
                        {!(rail === "sources"
                            ? filtered.length
                            : SAMPLE_QUESTIONS.some(q =>
                                  q.question.toLowerCase().includes(query.toLowerCase())
                              )) && (
                            <p className={d.emptySearch} role="status">
                                No matching {rail}.
                            </p>
                        )}
                    </div>
                    <div className={d.railFooter}>
                        <Check size={13} aria-hidden="true" />
                        {selected.length} of {SOURCES.length} sources in context
                    </div>
                </aside>
                <div className={d.main}>
                    <div className={d.toolbar}>
                        <button
                            ref={sourceButton}
                            type="button"
                            className={d.sourceToggle}
                            aria-label="Show sources"
                            aria-expanded={railOpen}
                            aria-controls="demo-sources"
                            onClick={() => setRailOpen(!railOpen)}
                        >
                            <Menu size={16} />
                        </button>
                        <div className={d.toolbarTitle}>
                            <strong>
                                {view === "chat"
                                    ? current
                                        ? "Ask over your sources"
                                        : "New conversation"
                                    : view === "knowledge"
                                      ? "Knowledge"
                                      : "Notebook"}
                            </strong>
                            <span>
                                {view === "chat"
                                    ? current
                                        ? "2 messages · sample conversation"
                                        : "Pick sources on the left, then ask."
                                    : "Acme workspace · sample data"}
                            </span>
                        </div>
                        <div className={d.toolbarActions}>
                            <button
                                type="button"
                                className={d.newChat}
                                aria-label="New chat"
                                disabled={view === "chat" && question === null}
                                onClick={() => {
                                    selectView("chat");
                                    setQuestion(null);
                                    setPrompt("");
                                    setFeedback("");
                                    setMissing([]);
                                    composer.current?.focus();
                                }}
                            >
                                <Plus size={12} aria-hidden="true" />
                                <span>New chat</span>
                            </button>
                            <div
                                ref={studio}
                                className={d.studioWrap}
                                onKeyDown={e => {
                                    if (e.key === "Escape") {
                                        setStudioOpen(false);
                                        studioButton.current?.focus();
                                    }
                                }}
                            >
                                <button
                                    ref={studioButton}
                                    type="button"
                                    className={d.studioButton}
                                    aria-expanded={studioOpen}
                                    aria-controls="demo-studio"
                                    onClick={() => setStudioOpen(!studioOpen)}
                                >
                                    <Zap size={13} aria-hidden="true" />
                                    Studio
                                    <ChevronDown size={12} aria-hidden="true" />
                                </button>
                                {studioOpen && (
                                    <div className={d.studioMenu} id="demo-studio">
                                        <strong>Studio</strong>
                                        <span>Explore a sample view</span>
                                        {(
                                            [
                                                {
                                                    id: "chat",
                                                    label: "Chat",
                                                    icon: Zap,
                                                    detail: "Ask over your sources",
                                                },
                                                {
                                                    id: "knowledge",
                                                    label: "Knowledge",
                                                    icon: BookOpen,
                                                    detail: "Browse your source library",
                                                },
                                                {
                                                    id: "notebook",
                                                    label: "Notebook",
                                                    icon: NotebookPen,
                                                    detail: "Turn context into a launch draft",
                                                },
                                            ] as const
                                        ).map(({ id, label, icon: Icon, detail }) => (
                                            <button
                                                type="button"
                                                key={id}
                                                aria-pressed={view === id}
                                                onClick={() => {
                                                    selectView(id);
                                                    studioButton.current?.focus();
                                                }}
                                            >
                                                <Icon size={16} aria-hidden="true" />
                                                <span>
                                                    {label}
                                                    <small>{detail}</small>
                                                </span>
                                                {view === id && <Check size={13} />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <span className={d.avatar} aria-label="Sample user Jamie Davis">
                                JD
                            </span>
                        </div>
                    </div>
                    {view === "chat" ? (
                        <div className={d.chat}>
                            <div className={d.transcript} aria-live="polite">
                                {current ? (
                                    <>
                                        <div className={d.userMessage}>
                                            <div className={d.messageAuthor}>
                                                <span className={d.avatar}>JD</span>You
                                            </div>
                                            <p>{current.question}</p>
                                        </div>
                                        <div className={d.answer}>
                                            <div className={d.messageAuthor}>
                                                <span className={d.assistantAvatar}>
                                                    <Zap size={14} aria-hidden="true" />
                                                </span>
                                                Launchstack
                                                <span className={d.messageMeta}>Sample answer</span>
                                            </div>
                                            <h3>{current.title}</h3>
                                            <p>{current.body}</p>
                                            <div className={d.citations}>
                                                {current.sources.map(id => {
                                                    const item = SOURCES.find(s => s.id === id)!;
                                                    return (
                                                        <button
                                                            type="button"
                                                            key={id}
                                                            onClick={() => setSource(id)}
                                                        >
                                                            <FileText
                                                                size={12}
                                                                aria-hidden="true"
                                                            />
                                                            {item.title}
                                                            <ArrowUpRight
                                                                size={11}
                                                                aria-hidden="true"
                                                            />
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <button
                                                className={d.textLink}
                                                type="button"
                                                onClick={() => selectView("notebook")}
                                            >
                                                Continue in Notebook
                                                <ArrowRight size={13} aria-hidden="true" />
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className={d.emptyConversation}>
                                        <LaunchstackMark size={36} />
                                        <h2>What do you want to ask?</h2>
                                        <p>Pick your sources. Start with a sample question.</p>
                                    </div>
                                )}
                            </div>
                            <div className={d.composerArea}>
                                <div className={d.starters} aria-label="Sample questions">
                                    {SAMPLE_QUESTIONS.map(item => (
                                        <button
                                            type="button"
                                            key={item.question}
                                            onClick={() => choosePrompt(item.question)}
                                        >
                                            {item.question}
                                        </button>
                                    ))}
                                </div>
                                <form
                                    className={d.composer}
                                    onSubmit={e => {
                                        e.preventDefault();
                                        submit();
                                    }}
                                >
                                    <div className={d.contextChips}>
                                        <span>Context</span>
                                        {selected.length ? (
                                            SOURCES.filter(s => selected.includes(s.id)).map(
                                                item => (
                                                    <button
                                                        type="button"
                                                        key={item.id}
                                                        aria-label={`Remove ${item.title} from context`}
                                                        onClick={() => toggleSource(item.id)}
                                                    >
                                                        {item.title}
                                                        <X size={10} aria-hidden="true" />
                                                    </button>
                                                )
                                            )
                                        ) : (
                                            <small>No sources selected</small>
                                        )}
                                    </div>
                                    <textarea
                                        ref={composer}
                                        aria-label="Ask a sample question"
                                        placeholder={
                                            selected.length
                                                ? `Ask anything about these ${selected.length} sources…`
                                                : "Pick sources on the left, then ask…"
                                        }
                                        value={prompt}
                                        onChange={e => {
                                            setPrompt(e.target.value);
                                            setFeedback("");
                                            setMissing([]);
                                        }}
                                        onKeyDown={e => {
                                            if (
                                                e.key === "Enter" &&
                                                !e.shiftKey &&
                                                !e.nativeEvent.isComposing
                                            ) {
                                                e.preventDefault();
                                                submit();
                                            }
                                        }}
                                        rows={2}
                                    />
                                    <div className={d.composerFooter}>
                                        <span>
                                            <Sparkles size={12} aria-hidden="true" />
                                            Sample questions only
                                        </span>
                                        <button
                                            type="submit"
                                            aria-label="Send sample question"
                                            disabled={!prompt.trim()}
                                        >
                                            <ArrowUp size={17} aria-hidden="true" />
                                        </button>
                                    </div>
                                </form>
                                {feedback && (
                                    <div className={d.feedback} role="status">
                                        <p>{feedback}</p>
                                        {missing.length ? (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelected(prev => [
                                                        ...new Set([...prev, ...missing]),
                                                    ]);
                                                    setMissing([]);
                                                    setFeedback(
                                                        "Context restored. Send your question to see the sample answer."
                                                    );
                                                    composer.current?.focus();
                                                }}
                                            >
                                                Include{" "}
                                                {missing
                                                    .map(
                                                        id => SOURCES.find(s => s.id === id)!.title
                                                    )
                                                    .join(" and ")}
                                            </button>
                                        ) : (
                                            <a href={SIGN_UP_URL}>
                                                Open your workspace
                                                <ArrowUpRight size={12} />
                                            </a>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : view === "knowledge" ? (
                        <div className={d.library}>
                            <div className={d.viewHeading}>
                                <h2>Your knowledge</h2>
                                <p>Every source has a place. Every answer has context.</p>
                            </div>
                            <div className={d.libraryHeader}>
                                <span>Name</span>
                                <span>Type</span>
                            </div>
                            {SOURCES.map(item => {
                                const Icon = sourceIcon(item.id);
                                return (
                                    <button
                                        type="button"
                                        className={d.libraryRow}
                                        key={item.id}
                                        onClick={() => setSource(item.id)}
                                    >
                                        <Icon size={17} aria-hidden="true" />
                                        <span>
                                            {item.title}
                                            <small>{item.detail}</small>
                                        </span>
                                        <span>{item.kind}</span>
                                        <ArrowUpRight size={13} aria-hidden="true" />
                                    </button>
                                );
                            })}
                            <a className={d.textLink} href={SIGN_UP_URL}>
                                <Plus size={14} />
                                Add your own sources
                            </a>
                        </div>
                    ) : (
                        <div className={d.notebook}>
                            <div className={d.viewHeading}>
                                <h2>Launch announcement</h2>
                                <p>A starting point, grounded in your product plan.</p>
                            </div>
                            <div className={d.noteActions}>
                                <span>
                                    <FileText size={13} />
                                    Sample notebook
                                </span>
                                <button
                                    type="button"
                                    onClick={() => setNote(note ? "" : SAMPLE_DRAFT)}
                                >
                                    {note ? "Reset draft" : "Create sample draft"}
                                    <Sparkles size={13} />
                                </button>
                            </div>
                            <textarea
                                aria-label="Sample launch draft"
                                value={note}
                                onChange={e => setNote(e.target.value)}
                                placeholder="Create a sample draft, then make it your own…"
                            />
                            <div className={d.noteStatus} role="status">
                                {note
                                    ? "Editable sample · kept only while this page is open"
                                    : "Based on the sample product plan and customer interviews"}
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <dialog
                ref={sourceDialog}
                className={d.sourceDialog}
                aria-labelledby="sample-source-title"
                onCancel={() => setSource(null)}
                onClose={() => setSource(null)}
                onClick={e => {
                    if (e.target === e.currentTarget) closeSource();
                }}
            >
                {excerpt && (
                    <div>
                        <div className={d.sourceDialogHeader}>
                            <span>
                                <FileText size={15} />
                                Sample source
                            </span>
                            <button
                                autoFocus
                                type="button"
                                onClick={closeSource}
                                aria-label="Close sample source"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <h2 id="sample-source-title">{excerpt.title}</h2>
                        <p>{excerpt.detail}</p>
                        <blockquote>“{excerpt.quote}”</blockquote>
                        <span className={d.sourceNotice}>
                            An excerpt from the fictional Acme workspace.
                        </span>
                    </div>
                )}
            </dialog>
        </section>
    );
}

const MAP_NODES = [
    {
        name: "Customer discovery",
        description: "Interview notes reveal what people need.",
        icon: "mic",
        x: 12,
        y: 20,
    },
    {
        name: "Product strategy",
        description: "Plans connect customer needs to your next milestone.",
        icon: "file",
        x: 70,
        y: 15,
    },
    {
        name: "Your repository",
        description: "Imported code and documentation supply technical context.",
        icon: "github",
        x: 76,
        y: 68,
    },
    {
        name: "Research & notes",
        description: "Your written context becomes part of the bigger picture.",
        icon: "notion",
        x: 10,
        y: 73,
    },
];
export function KnowledgeMap() {
    const [active, setActive] = useState(0);
    return (
        <div className={s.knowledgeMap}>
            <div className={s.mapTop}>
                <span>
                    <span />
                    One connected workspace
                </span>
                <span>Explore a source</span>
            </div>
            <div className={s.mapCanvas}>
                <svg viewBox="0 0 600 300" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M100 66 C200 66 190 150 300 150" />
                    <path d="M470 50 C400 50 400 150 300 150" />
                    <path d="M500 230 C400 230 420 150 300 150" />
                    <path d="M100 230 C200 230 200 150 300 150" />
                    <path
                        className={s.mapActiveLine}
                        d={
                            [
                                "M100 66 C200 66 190 150 300 150",
                                "M470 50 C400 50 400 150 300 150",
                                "M500 230 C400 230 420 150 300 150",
                                "M100 230 C200 230 200 150 300 150",
                            ][active]
                        }
                    />
                </svg>
                <div className={s.mapHub}>
                    <LaunchstackMark size={45} />
                    <span>Your company</span>
                </div>
                {MAP_NODES.map((node, i) => (
                    <button
                        type="button"
                        aria-pressed={active === i}
                        key={node.name}
                        onClick={() => setActive(i)}
                        className={`${s.mapNode} ${active === i ? s.mapNodeActive : ""}`}
                        style={{ left: `${node.x}%`, top: `${node.y}%` }}
                    >
                        {node.icon === "mic" ? (
                            <Mic size={19} aria-hidden="true" />
                        ) : node.icon === "file" ? (
                            <FileText size={19} aria-hidden="true" />
                        ) : (
                            <Image src={`/brands/${node.icon}.svg`} alt="" width={22} height={22} />
                        )}
                        <span>{node.name}</span>
                    </button>
                ))}
            </div>
            <div className={s.mapCaption} aria-live="polite">
                <span>{MAP_NODES[active]!.name}</span>
                <p>{MAP_NODES[active]!.description}</p>
            </div>
        </div>
    );
}
