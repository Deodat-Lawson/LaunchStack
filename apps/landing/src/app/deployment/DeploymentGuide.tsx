"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    BookOpen,
    Check,
    Copy,
    Menu,
    Search,
    X,
} from "lucide-react";
import { LaunchstackMark } from "../_components/LaunchstackLogo";
import { ThemeToggle } from "../_components/ThemeToggle";
import { GITHUB_REPO, SIGN_IN_URL } from "~/config/site";
import {
    CONFIG_REVISION,
    GUIDES,
    filterGuides,
    resolveGuide,
    type GuideBlock,
    type GuideLink,
} from "./deploymentContent";
import s from "~/styles/deploymentGuide.module.css";

function ReferenceLink({ link }: { link: GuideLink }) {
    return link.href.startsWith("/") ? (
        <Link href={link.href}>
            {link.label}
            <ArrowRight size={14} aria-hidden="true" />
        </Link>
    ) : (
        <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
            <ArrowUpRight size={14} aria-hidden="true" />
        </a>
    );
}

function CodeBlock({ block }: { block: GuideBlock }) {
    const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
    useEffect(() => {
        if (status === "idle") return;
        const timer = setTimeout(() => setStatus("idle"), 3500);
        return () => clearTimeout(timer);
    }, [status]);
    async function copy() {
        try {
            await navigator.clipboard.writeText(block.code ?? "");
            setStatus("copied");
        } catch {
            setStatus("error");
        }
    }
    return (
        <div className={s.codeBlock}>
            <div className={s.codeHeader}>
                <span>{block.file ?? "Configuration"}</span>
                <button
                    type="button"
                    onClick={() => void copy()}
                    aria-label={`Copy ${block.title} code`}
                >
                    {status === "copied" ? (
                        <Check size={14} aria-hidden="true" />
                    ) : (
                        <Copy size={14} aria-hidden="true" />
                    )}
                    {status === "copied" ? "Copied" : "Copy"}
                </button>
            </div>
            <pre tabIndex={0} aria-label={`${block.title} code`}>
                <code>{block.code}</code>
            </pre>
            <div role="status" className={status === "error" ? s.copyError : s.srOnly}>
                {status === "error"
                    ? "Clipboard unavailable. Select the code above and copy it manually."
                    : status === "copied"
                      ? "Code copied to clipboard."
                      : ""}
            </div>
        </div>
    );
}

export function DeploymentGuide({ guideId }: { guideId: string }) {
    const guide = resolveGuide(guideId);
    const [query, setQuery] = useState("");
    const [mobileOpen, setMobileOpen] = useState(false);
    const search = useRef<HTMLInputElement>(null);
    const menu = useRef<HTMLButtonElement>(null);
    const mobileDialog = useRef<HTMLDialogElement>(null);
    const mobileSearch = useRef<HTMLInputElement>(null);
    const results = filterGuides(query);
    const index = GUIDES.findIndex(item => item.id === guide.id);
    const previous = GUIDES[index - 1];
    const next = GUIDES[index + 1];

    useEffect(() => {
        setQuery("");
        setMobileOpen(false);
    }, [guideId]);
    useEffect(() => {
        if (mobileOpen) {
            mobileDialog.current?.showModal();
            mobileSearch.current?.focus();
            const old = document.body.style.overflow;
            document.body.style.overflow = "hidden";
            return () => {
                document.body.style.overflow = old;
            };
        }
        mobileDialog.current?.close();
    }, [mobileOpen]);
    useEffect(() => {
        function onKey(event: KeyboardEvent) {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                if (window.matchMedia("(max-width: 860px)").matches) setMobileOpen(true);
                else search.current?.focus();
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);
    const closeMenu = () => {
        setMobileOpen(false);
        menu.current?.focus();
    };

    function navigation(mobile = false) {
        return (
            <>
                <div className={s.railHeading}>
                    <BookOpen size={16} aria-hidden="true" />
                    <strong>Deployment guide</strong>
                </div>
                <div className={s.search}>
                    <Search size={15} aria-hidden="true" />
                    <input
                        ref={mobile ? mobileSearch : search}
                        aria-label="Search deployment guide"
                        placeholder="Search configuration…"
                        value={query}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => {
                            if (event.key === "Escape" && query) {
                                event.preventDefault();
                                event.stopPropagation();
                                setQuery("");
                            }
                        }}
                    />
                    {query && (
                        <button
                            type="button"
                            onClick={() => {
                                setQuery("");
                                (mobile ? mobileSearch : search).current?.focus();
                            }}
                            aria-label="Clear guide search"
                        >
                            <X size={14} aria-hidden="true" />
                        </button>
                    )}
                </div>
                {query && (
                    <p className={s.resultCount} role="status">
                        {results.length} {results.length === 1 ? "section" : "sections"} found
                    </p>
                )}
                <nav aria-label="Deployment sections">
                    {(["Get started", "Configure", "Operate"] as const).map(group => {
                        const items = results.filter(item => item.group === group);
                        return items.length ? (
                            <div key={group} className={s.navGroup}>
                                <h2>{group}</h2>
                                {items.map(item => (
                                    <Link
                                        key={item.id}
                                        href={`/deployment?section=${item.id}`}
                                        aria-current={item.id === guide.id ? "page" : undefined}
                                        onClick={() => {
                                            if (mobile) closeMenu();
                                            setQuery("");
                                        }}
                                    >
                                        {item.title}
                                        {item.id === guide.id && <span className={s.activeDot} />}
                                    </Link>
                                ))}
                            </div>
                        ) : null;
                    })}
                    {results.length === 0 && (
                        <div className={s.emptySearch}>
                            <strong>No matching sections</strong>
                            <p>Try a setting such as S3, OAuth, or EMBEDDING_INDEX.</p>
                            <button type="button" onClick={() => setQuery("")}>
                                Clear search
                            </button>
                        </div>
                    )}
                </nav>
                <a
                    className={s.railFooter}
                    href={`${GITHUB_REPO}/issues`}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Report a docs issue
                    <ArrowUpRight size={14} aria-hidden="true" />
                </a>
            </>
        );
    }

    return (
        <div className={s.root}>
            <a href="#guide-content" className={s.skipLink}>
                Skip to guide
            </a>
            <header className={s.header}>
                <div className={s.headerStart}>
                    <Link className={s.brand} href="/" aria-label="Launchstack home">
                        <LaunchstackMark size={26} />
                        <span>Launchstack</span>
                    </Link>
                    <span className={s.headerDivider} />
                    <Link href="/deployment" className={s.docsLabel}>
                        Docs
                    </Link>
                </div>
                <div className={s.headerActions}>
                    <a
                        className={s.sourceLink}
                        href={GITHUB_REPO}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Source code <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                    <ThemeToggle className={s.iconButton} />
                    <a className={s.appLink} href={SIGN_IN_URL}>
                        Open app
                        <ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                    <button
                        ref={menu}
                        className={`${s.iconButton} ${s.mobileMenu}`}
                        type="button"
                        aria-label="Open deployment navigation"
                        aria-expanded={mobileOpen}
                        aria-controls="mobile-guide-navigation"
                        onClick={() => setMobileOpen(true)}
                    >
                        <Menu size={19} aria-hidden="true" />
                    </button>
                </div>
            </header>
            <div className={s.shell}>
                <aside className={s.sidebar}>{navigation()}</aside>
                <main id="guide-content" className={s.main} tabIndex={-1}>
                    <article className={s.article} key={guide.id}>
                        <div className={s.breadcrumb}>
                            <Link href="/deployment">Deployment</Link>
                            <span>/</span>
                            <span>{guide.group}</span>
                        </div>
                        <div className={s.pageLabel}>
                            <span />
                            Self-hosting reference
                        </div>
                        <h1>{guide.title}</h1>
                        <p className={s.summary}>{guide.summary}</p>
                        <nav className={s.onThisPage} aria-label="On this page">
                            <strong>On this page</strong>
                            <div>
                                {guide.blocks.map((block, i) => (
                                    <a key={block.title} href={`#step-${i + 1}`}>
                                        {block.title}
                                    </a>
                                ))}
                            </div>
                        </nav>
                        {guide.blocks.map((block, i) => (
                            <section key={block.title} className={s.block} id={`step-${i + 1}`}>
                                <h2>
                                    <a href={`#step-${i + 1}`}>
                                        {block.title}
                                        <span aria-hidden="true">#</span>
                                    </a>
                                </h2>
                                {block.body.map(paragraph => (
                                    <p key={paragraph}>{paragraph}</p>
                                ))}
                                {block.rows && (
                                    <dl className={s.configRows}>
                                        {block.rows.map(row => (
                                            <div key={row.name}>
                                                <dt>{row.name}</dt>
                                                <dd>{row.detail}</dd>
                                            </div>
                                        ))}
                                    </dl>
                                )}
                                {block.code && <CodeBlock block={block} />}
                                {block.note && (
                                    <div className={s.note}>
                                        <BookOpen size={16} aria-hidden="true" />
                                        <p>{block.note}</p>
                                    </div>
                                )}
                                {block.links && (
                                    <div className={s.relatedLinks}>
                                        {block.links.map(link => (
                                            <ReferenceLink key={link.href} link={link} />
                                        ))}
                                    </div>
                                )}
                            </section>
                        ))}
                        <footer className={s.references}>
                            <strong>Configuration sources</strong>
                            <p>
                                Checked against app revision <code>{CONFIG_REVISION}</code>. Use the
                                configuration shipped with your release when deploying a different
                                version.
                            </p>
                            <div className={s.relatedLinks}>
                                {guide.sources.map(link => (
                                    <ReferenceLink key={link.href} link={link} />
                                ))}
                            </div>
                        </footer>
                        <nav className={s.pageNavigation} aria-label="Adjacent guide sections">
                            {previous ? (
                                <Link href={`/deployment?section=${previous.id}`}>
                                    <ArrowLeft size={16} aria-hidden="true" />
                                    <span>
                                        <small>Previous</small>
                                        {previous.title}
                                    </span>
                                </Link>
                            ) : (
                                <span />
                            )}
                            {next && (
                                <Link href={`/deployment?section=${next.id}`}>
                                    <span>
                                        <small>Next</small>
                                        {next.title}
                                    </span>
                                    <ArrowRight size={16} aria-hidden="true" />
                                </Link>
                            )}
                        </nav>
                    </article>
                </main>
            </div>
            <dialog
                id="mobile-guide-navigation"
                ref={mobileDialog}
                className={s.mobileDialog}
                aria-label="Deployment navigation"
                onCancel={event => {
                    event.preventDefault();
                    closeMenu();
                }}
                onClick={event => {
                    if (event.target === event.currentTarget) closeMenu();
                }}
            >
                <div className={s.mobileRail}>
                    <button
                        className={`${s.iconButton} ${s.closeMenu}`}
                        type="button"
                        aria-label="Close deployment navigation"
                        onClick={closeMenu}
                    >
                        <X size={18} aria-hidden="true" />
                    </button>
                    {navigation(true)}
                </div>
            </dialog>
        </div>
    );
}
