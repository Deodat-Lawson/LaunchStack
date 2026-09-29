"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import {
    ArrowDown,
    ArrowUpRight,
    AudioLines,
    BookOpen,
    Check,
    Code2,
    FileText,
    GitBranch,
    Heart,
    Menu,
    Plus,
    ShieldCheck,
    Sparkles,
    X,
} from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";
import { LaunchstackMark } from "./LaunchstackLogo";
import { KnowledgeMap, StartupDemo } from "./StartupDemo";
import { LANDING_FAQS } from "./landingContent";
import { GITHUB_REPO, SIGN_IN_URL, SIGN_UP_URL } from "~/config/site";
import s from "../../styles/startup.module.css";

const IMPORTS = [
    {
        name: "Notion",
        asset: "notion",
        method: "Export import",
        description:
            "Give your notes a second life. Upload a Notion export as Markdown or a ZIP archive to make your written context searchable.",
    },
    {
        name: "Google Drive",
        asset: "googledrive",
        method: "Workspace connection",
        description:
            "Connect Google Drive when your instance has Google OAuth enabled, or upload supported files and exports to bring your team's knowledge together.",
    },
    {
        name: "GitHub",
        asset: "github",
        method: "Repository import",
        description:
            "Put your code in context. Import a repository so its documentation and source can inform your questions and research.",
    },
    {
        name: "Markdown",
        asset: "markdown",
        method: "File import",
        description:
            "Start with what you've already written. Import Markdown notes, plain text, and structured files into your workspace.",
    },
];

export function LandingClient() {
    const [menuOpen, setMenuOpen] = useState(false);
    const [selectedImport, setSelectedImport] = useState(0);
    const menuButton = useRef<HTMLButtonElement>(null);
    const closeMenu = () => setMenuOpen(false);
    return (
        <MotionConfig reducedMotion="user">
            <div className={s.root}>
                <a className={s.skipLink} href="#main">
                    Skip to content
                </a>
                <header className={s.header}>
                    <nav className={s.nav} aria-label="Main navigation">
                        <Link href="/" className={s.brand} aria-label="Launchstack home">
                            <LaunchstackMark size={30} />
                            <span>Launchstack</span>
                        </Link>
                        <div className={s.navLinks}>
                            <a href="#features">Product</a>
                            <a href="#sources">Your stack</a>
                            <Link href="/pricing">Pricing</Link>
                            <Link href="/deployment">
                                Resources <ArrowUpRight size={12} aria-hidden="true" />
                            </Link>
                        </div>
                        <div className={s.navActions}>
                            <ThemeToggle className={s.themeSwitch} />
                            <a
                                className={s.githubLink}
                                href={GITHUB_REPO}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label="Launchstack on GitHub (opens in a new tab)"
                            >
                                <Image src="/brands/github.svg" alt="" width={19} height={19} />
                            </a>
                            <a className={s.signIn} href={SIGN_IN_URL}>
                                Log in
                            </a>
                            <a href={SIGN_UP_URL} className={s.navPrimary}>
                                Start building <ArrowUpRight size={14} aria-hidden="true" />
                            </a>
                            <button
                                ref={menuButton}
                                type="button"
                                className={s.menuButton}
                                aria-label={menuOpen ? "Close navigation" : "Open navigation"}
                                aria-expanded={menuOpen}
                                aria-controls="mobile-navigation"
                                onClick={() => setMenuOpen(!menuOpen)}
                            >
                                {menuOpen ? (
                                    <X size={22} aria-hidden="true" />
                                ) : (
                                    <Menu size={22} aria-hidden="true" />
                                )}
                            </button>
                        </div>
                    </nav>
                    {menuOpen && (
                        <nav
                            id="mobile-navigation"
                            className={s.mobileNav}
                            aria-label="Mobile navigation"
                            onKeyDown={e => {
                                if (e.key === "Escape") {
                                    closeMenu();
                                    menuButton.current?.focus();
                                }
                            }}
                        >
                            <a href="#features" onClick={closeMenu}>
                                Product
                            </a>
                            <a href="#sources" onClick={closeMenu}>
                                Your stack
                            </a>
                            <Link href="/pricing" onClick={closeMenu}>
                                Pricing
                            </Link>
                            <Link href="/deployment" onClick={closeMenu}>
                                Deployment guide
                            </Link>
                            <a href={SIGN_IN_URL}>Log in</a>
                            <a href={SIGN_UP_URL}>Start building</a>
                        </nav>
                    )}
                </header>

                <main id="main">
                    <section className={s.hero} aria-labelledby="hero-heading">
                        <div className={s.heroIntro}>
                            <div className={s.heroHeading}>
                                <a
                                    className={s.releaseBadge}
                                    href={GITHUB_REPO}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <span className={s.releaseDot} />
                                    Open source. Open possibilities.
                                    <ArrowUpRight size={13} aria-hidden="true" />
                                </a>
                                <h1 id="hero-heading">
                                    A place for your
                                    <br />
                                    next big thing<span className={s.heroPeriod}>.</span>
                                </h1>
                            </div>
                            <div className={s.heroDescription}>
                                <span className={s.heroCategory}>The startup operating system</span>
                                <p>
                                    Your knowledge, your next move, your entire journey. Bring it
                                    together in one workspace built for the way founders work.
                                </p>
                                <div className={s.heroActions}>
                                    <a href={SIGN_UP_URL} className={s.primaryButton}>
                                        Start building <ArrowUpRight size={17} aria-hidden="true" />
                                    </a>
                                    <a href="#product-demo" className={s.tourButton}>
                                        Explore the product{" "}
                                        <ArrowDown size={15} aria-hidden="true" />
                                    </a>
                                </div>
                                <span className={s.heroFinePrint}>
                                    <Check size={13} aria-hidden="true" />
                                    Free & open source <span /> Yours to self-host
                                </span>
                            </div>
                        </div>
                        <StartupDemo />
                    </section>

                    <section className={s.sourceStrip} aria-label="Bring the tools you already use">
                        <p>
                            Big ideas start everywhere.
                            <br />
                            <strong>Bring yours together.</strong>
                        </p>
                        <div>
                            {IMPORTS.map(item => (
                                <a
                                    key={item.name}
                                    href="#sources"
                                    onClick={() => setSelectedImport(IMPORTS.indexOf(item))}
                                >
                                    <Image
                                        src={`/brands/${item.asset}.svg`}
                                        alt=""
                                        width={27}
                                        height={27}
                                    />
                                    <span>{item.name}</span>
                                </a>
                            ))}
                            <a href="#sources">
                                <AudioLines size={27} strokeWidth={1.6} aria-hidden="true" />
                                <span>Your recordings</span>
                            </a>
                        </div>
                    </section>

                    <section
                        className={`${s.section} ${s.featuresSection}`}
                        id="features"
                        aria-labelledby="features-heading"
                    >
                        <div className={s.sectionHeading}>
                            <span className={s.sectionKicker}>Less scattered. More connected.</span>
                            <h2 id="features-heading">
                                Your best work starts
                                <br />
                                with the full picture.
                            </h2>
                            <p>
                                The thinking behind your startup shouldn’t disappear into tabs,
                                folders, and forgotten conversations.
                            </p>
                        </div>
                        <div className={s.featureSplit}>
                            <div className={s.featureCopy}>
                                <span className={s.featureIcon}>
                                    <BookOpen size={22} strokeWidth={1.5} aria-hidden="true" />
                                </span>
                                <h3>
                                    One home for
                                    <br />
                                    everything you know.
                                </h3>
                                <p>
                                    Connect your research, documents, conversations, and code. Turn
                                    scattered information into shared company knowledge that gets
                                    more useful as you build.
                                </p>
                                <ul>
                                    <li>
                                        <Check size={15} aria-hidden="true" />
                                        Ask questions across your sources
                                    </li>
                                    <li>
                                        <Check size={15} aria-hidden="true" />
                                        Trace every answer back to its context
                                    </li>
                                    <li>
                                        <Check size={15} aria-hidden="true" />
                                        Keep your team working from the same picture
                                    </li>
                                </ul>
                                <a href="#product-demo" className={s.inlineLink}>
                                    Explore your workspace{" "}
                                    <ArrowUpRight size={15} aria-hidden="true" />
                                </a>
                            </div>
                            <KnowledgeMap />
                        </div>
                        <div className={s.featurePair}>
                            <article className={s.featureArticle}>
                                <div className={s.featureMiniReview}>
                                    <div>
                                        <span className={s.miniReviewIcon}>
                                            <Sparkles size={16} aria-hidden="true" />
                                        </span>
                                        <span>
                                            Founder weekly review
                                            <small>Your context, distilled.</small>
                                        </span>
                                        <span className={s.readyBadge}>Ready to review</span>
                                    </div>
                                    <p>
                                        <span className={s.reviewLine} />
                                        <span className={s.reviewLine} />
                                        <span className={s.reviewLine} />
                                    </p>
                                    <div className={s.reviewChips}>
                                        <span>
                                            <MessageIcon /> Key decisions
                                        </span>
                                        <span>
                                            <GitBranch size={12} aria-hidden="true" /> Open
                                            questions
                                        </span>
                                        <span>
                                            <ArrowUpRight size={12} aria-hidden="true" /> Next steps
                                        </span>
                                    </div>
                                </div>
                                <h3>Know what deserves your attention.</h3>
                                <p>
                                    Get a founder review grounded in your workspace. Surface the
                                    decisions, gaps, and questions that help you choose your next
                                    move.
                                </p>
                            </article>
                            <article className={s.featureArticle}>
                                <div className={s.featureMiniFlow}>
                                    <span>
                                        <FileText size={24} strokeWidth={1.3} aria-hidden="true" />
                                        <small>Your context</small>
                                    </span>
                                    <div className={s.flowConnector} />
                                    <span className={s.flowCenter}>
                                        <Sparkles size={24} strokeWidth={1.3} aria-hidden="true" />
                                        <small>A little AI help</small>
                                    </span>
                                    <div className={s.flowConnector} />
                                    <span>
                                        <ArrowUpRight
                                            size={24}
                                            strokeWidth={1.3}
                                            aria-hidden="true"
                                        />
                                        <small>Your next launch</small>
                                    </span>
                                </div>
                                <h3>Go from knowing to doing.</h3>
                                <p>
                                    Turn the thinking you’ve already done into research, plans, and
                                    source-grounded marketing content. Start with context. Leave
                                    with a head start.
                                </p>
                            </article>
                        </div>
                    </section>

                    <section
                        className={s.sourcesSection}
                        id="sources"
                        aria-labelledby="sources-heading"
                    >
                        <div className={s.sourcesInner}>
                            <div className={s.sourcesCopy}>
                                <span className={s.sectionKicker}>Your stack has a home here</span>
                                <h2 id="sources-heading">
                                    Keep your tools.
                                    <br />
                                    Connect your thinking.
                                </h2>
                                <p>
                                    You’ve already done the work. Bring it into Launchstack through
                                    files, recordings, repository imports, and configured workspace
                                    connections.
                                </p>
                                <Link href="/deployment" className={s.inlineLink}>
                                    See how to get started{" "}
                                    <ArrowUpRight size={15} aria-hidden="true" />
                                </Link>
                                <div className={s.fileTypes}>
                                    <span>PDF</span>
                                    <span>DOCX</span>
                                    <span>MD</span>
                                    <span>MP3</span>
                                    <span>MP4</span>
                                    <span>ZIP</span>
                                </div>
                            </div>
                            <div className={s.importBrowser}>
                                <div className={s.importBrowserHeader}>
                                    <span>Your context, connected</span>
                                    <span>Select a source</span>
                                </div>
                                <div className={s.importGrid}>
                                    {IMPORTS.map((item, i) => (
                                        <button
                                            key={item.name}
                                            type="button"
                                            className={`${s.importCard} ${selectedImport === i ? s.importSelected : ""}`}
                                            onClick={() => setSelectedImport(i)}
                                            aria-pressed={selectedImport === i}
                                        >
                                            <Image
                                                src={`/brands/${item.asset}.svg`}
                                                alt=""
                                                width={32}
                                                height={32}
                                            />
                                            <strong>{item.name}</strong>
                                            <span>{item.method}</span>
                                            {selectedImport === i && (
                                                <Check size={14} aria-hidden="true" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                                <div className={s.importDescription} aria-live="polite">
                                    <b>{IMPORTS[selectedImport]!.name}</b>
                                    <p>{IMPORTS[selectedImport]!.description}</p>
                                </div>
                                <div className={s.importNote}>
                                    <ShieldCheck size={14} aria-hidden="true" />
                                    You choose what comes into your workspace.
                                </div>
                            </div>
                        </div>
                    </section>

                    <section
                        className={`${s.section} ${s.ownershipSection}`}
                        id="open-source"
                        aria-labelledby="ownership-heading"
                    >
                        <div className={s.ownershipIntro}>
                            <span className={s.sectionKicker}>Build on your own terms</span>
                            <h2 id="ownership-heading">
                                Your company.
                                <br />
                                Your context. Your call.
                            </h2>
                            <p>
                                An operating system should give you more control. That’s why
                                Launchstack is open source from the start.
                            </p>
                            <a
                                href={GITHUB_REPO}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={s.inlineLink}
                            >
                                <Image src="/brands/github.svg" alt="" width={18} height={18} />
                                Explore the source <ArrowUpRight size={15} aria-hidden="true" />
                            </a>
                        </div>
                        <div className={s.ownershipPoints}>
                            <article>
                                <Code2 size={22} strokeWidth={1.5} aria-hidden="true" />
                                <div>
                                    <h3>Open by design</h3>
                                    <p>
                                        Inspect, adapt, and build on the code. Apache 2.0 gives you
                                        room to make it yours.
                                    </p>
                                </div>
                            </article>
                            <article>
                                <ShieldCheck size={22} strokeWidth={1.5} aria-hidden="true" />
                                <div>
                                    <h3>Your data, on your terms</h3>
                                    <p>
                                        Self-host on infrastructure you control, with your own
                                        storage and model providers.
                                    </p>
                                </div>
                            </article>
                            <article>
                                <LayersIcon />
                                <div>
                                    <h3>Start small. Keep building.</h3>
                                    <p>
                                        Begin with a few documents. Add more context and invite your
                                        team as your company grows.
                                    </p>
                                </div>
                            </article>
                        </div>
                    </section>

                    <section
                        className={`${s.section} ${s.faqSection}`}
                        aria-labelledby="faq-heading"
                    >
                        <div>
                            <span className={s.sectionKicker}>
                                A few things you might be wondering
                            </span>
                            <h2 id="faq-heading">Good questions.</h2>
                            <p>
                                Have something else in mind?
                                <br />
                                <Link href="/contact" className={s.inlineLink}>
                                    Let’s talk <ArrowUpRight size={14} aria-hidden="true" />
                                </Link>
                            </p>
                        </div>
                        <div className={s.faqList}>
                            {LANDING_FAQS.map(faq => (
                                <details key={faq.question} className={s.faqItem}>
                                    <summary>
                                        {faq.question}
                                        <Plus size={18} aria-hidden="true" />
                                    </summary>
                                    <p>{faq.answer}</p>
                                </details>
                            ))}
                        </div>
                    </section>

                    <section className={s.finalCta} aria-labelledby="cta-heading">
                        <div className={s.ctaMotif} aria-hidden="true">
                            <span />
                            <span />
                            <span />
                        </div>
                        <div>
                            <span className={s.ctaEyebrow}>
                                For the ideas that won’t leave you alone.
                            </span>
                            <h2 id="cta-heading">
                                Give your next big thing
                                <br />a place to begin.
                            </h2>
                            <div className={s.ctaActions}>
                                <a href={SIGN_UP_URL} className={s.primaryButton}>
                                    Start building <ArrowUpRight size={17} aria-hidden="true" />
                                </a>
                                <Link href="/deployment">
                                    Host it yourself <ArrowUpRight size={16} aria-hidden="true" />
                                </Link>
                            </div>
                            <p>Free software. Open source. All yours.</p>
                        </div>
                    </section>
                </main>
                <footer className={s.footer}>
                    <div className={s.footerTop}>
                        <div>
                            <Link className={s.brand} href="/" aria-label="Launchstack home">
                                <LaunchstackMark size={29} />
                                <span>Launchstack</span>
                            </Link>
                            <p>
                                A little less friction.
                                <br />A lot more possibility.
                            </p>
                        </div>
                        <div className={s.footerLinks}>
                            <div>
                                <h3>Product</h3>
                                <a href="#features">Overview</a>
                                <a href="#sources">Your stack</a>
                                <Link href="/pricing">Pricing</Link>
                            </div>
                            <div>
                                <h3>Build with us</h3>
                                <Link href="/deployment">Documentation</Link>
                                <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">
                                    GitHub <ArrowUpRight size={12} aria-hidden="true" />
                                </a>
                                <a
                                    href={`${GITHUB_REPO}/blob/main/LICENSE`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Apache 2.0 license
                                </a>
                            </div>
                            <div>
                                <h3>Say hello</h3>
                                <Link href="/contact">Contact</Link>
                                <a
                                    href={`${GITHUB_REPO}/issues`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    Feedback <ArrowUpRight size={12} aria-hidden="true" />
                                </a>
                            </div>
                        </div>
                    </div>
                    <div className={s.footerBottom}>
                        <span>© {new Date().getFullYear()} Launchstack</span>
                        <span>
                            Made for the ones who build.
                            <Heart size={12} aria-hidden="true" />
                        </span>
                        <a href="#main">
                            Back to top <ArrowUpRight size={12} aria-hidden="true" />
                        </a>
                    </div>
                </footer>
            </div>
        </MotionConfig>
    );
}

function MessageIcon() {
    return <FileText size={12} aria-hidden="true" />;
}
function LayersIcon() {
    return <BookOpen size={22} strokeWidth={1.5} aria-hidden="true" />;
}
