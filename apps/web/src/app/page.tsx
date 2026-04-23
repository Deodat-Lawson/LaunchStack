import type { Metadata } from 'next';
import Link from "next/link";
import Image from "next/image";
import React from 'react';

export const metadata: Metadata = {
    title: 'Launchstack — The Open-Source Launch Stack for Tech Founders',
    description: 'Launchstack is a free, open-source AI platform that helps tech founders analyze documents, detect compliance gaps, manage teams, and grow their product. Self-host with your own API keys.',
    alternates: {
        canonical: '/',
    },
};
import {
    Brain, ArrowRight, FileSearch, Upload, Sparkles, CheckCircle,
    Github, Heart, Code2, ExternalLink, HelpCircle,
} from 'lucide-react';
import { Navbar } from './_components/Navbar';
import { LaunchstackMark } from './_components/LaunchstackLogo';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://launchstack.app';
const GITHUB_REPO = "https://github.com/Deodat-Lawson/pdr_ai_v2";

const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Launchstack',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'DeveloperApplication',
    operatingSystem: 'Web',
    description: 'Launchstack is a free, open-source AI platform that helps tech founders analyze documents, detect compliance gaps, manage teams, and grow their product. It supports 12+ document types and can be self-hosted with your own API keys.',
    url: SITE_URL,
    downloadUrl: GITHUB_REPO,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    creator: { '@type': 'Organization', name: 'Launchstack', url: SITE_URL },
    featureList: 'Document RAG, Predictive Analysis, Contract Review, AI Q&A, Employee Management, Analytics Dashboard, Marketing Pipeline, Self-Hosting',
    screenshot: `${SITE_URL}/og-image.png`,
    softwareVersion: '2.0',
    license: 'https://opensource.org/licenses/MIT',
};

const organizationLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Launchstack',
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.ico`,
    description: 'Launchstack builds free, open-source tools that help tech founders grow their products.',
    sameAs: [GITHUB_REPO],
};

const faqLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [
        {
            '@type': 'Question',
            name: 'What is Launchstack?',
            acceptedAnswer: {
                '@type': 'Answer',
                text: 'Launchstack is a free, open-source AI platform built for tech founders. It helps you analyze documents, detect compliance gaps, manage your team, and generate marketing content — all self-hostable with your own API keys.',
            },
        },
        {
            '@type': 'Question',
            name: 'Is Launchstack really free?',
            acceptedAnswer: {
                '@type': 'Answer',
                text: 'Yes. Launchstack is 100% free and open source under the MIT license. You can self-host it on your own infrastructure using your own API keys, with no usage limits and no hidden costs.',
            },
        },
        {
            '@type': 'Question',
            name: 'Can I self-host Launchstack?',
            acceptedAnswer: {
                '@type': 'Answer',
                text: 'Absolutely. Launchstack can be deployed on Vercel, Docker, or any self-hosted server. You bring your own API keys and maintain full control over your data and infrastructure.',
            },
        },
        {
            '@type': 'Question',
            name: 'What document types does Launchstack support?',
            acceptedAnswer: {
                '@type': 'Answer',
                text: 'Launchstack supports 12+ document types across 8 domains including contracts, financial documents, technical specs, compliance filings, HR policies, educational materials, research papers, and general documents.',
            },
        },
        {
            '@type': 'Question',
            name: 'How is Launchstack different from other document AI tools?',
            acceptedAnswer: {
                '@type': 'Answer',
                text: 'Unlike proprietary alternatives, Launchstack is fully open source and free. It combines document RAG with predictive gap detection, team management, and marketing tools in a single platform. You own your data and can customize every aspect of the platform.',
            },
        },
    ],
};

export default function HomePage() {
    return (
        <div className="min-h-screen bg-white dark:bg-[#080010] text-gray-900 dark:text-white overflow-x-hidden transition-colors duration-200">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd) }}
            />
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
            />
            <Navbar />

            {/* ── Hero ─────────────────────────────────────────────── */}
            <section className="relative flex flex-col items-center justify-center text-center px-4 pt-28 pb-20">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(147,51,234,0.12),transparent)] dark:bg-[radial-gradient(ellipse_80%_50%_at_50%_-10%,rgba(147,51,234,0.22),transparent)] pointer-events-none" />

                {/* GitHub badge */}
                <a
                    href={GITHUB_REPO}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800/60 rounded-full px-4 py-1.5 text-sm text-purple-700 dark:text-purple-300 mb-8 hover:border-purple-400 dark:hover:border-purple-500 transition-colors relative"
                >
                    <Github className="w-3.5 h-3.5" />
                    Open Source · ⭐ Star on GitHub
                    <ArrowRight className="w-3 h-3 opacity-60" />
                </a>

                <h1 className="text-5xl md:text-7xl font-bold leading-tight tracking-tight max-w-4xl mb-6 relative">
                    The Open-Source Launch Stack<br />
                    <span className="text-purple-600 dark:text-purple-400">for Tech Founders</span>
                </h1>
                <p className="text-lg md:text-xl text-gray-500 dark:text-gray-400 max-w-2xl mb-10 leading-relaxed relative">
                    Document AI, growth tools, and team management — built by founders, for founders. Completely free, fully open source, and self-hostable with your own API keys.
                </p>

                <div className="flex flex-col sm:flex-row gap-3 items-center relative">
                    <Link href="/signup">
                        <button className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-7 py-3 rounded-full transition-colors text-base cursor-pointer flex items-center gap-2">
                            Try it out <ArrowRight className="w-4 h-4" />
                        </button>
                    </Link>
                    <Link href="/deployment?section=main">
                        <button className="flex items-center gap-2 bg-gray-100 dark:bg-purple-950/50 hover:bg-gray-200 dark:hover:bg-purple-900/50 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-purple-700/40 font-semibold px-7 py-3 rounded-full transition-colors text-base cursor-pointer">
                            <Github className="w-4 h-4" />
                            Deploy via GitHub
                        </button>
                    </Link>
                    <Link href="/deployment">
                        <button className="text-gray-400 dark:text-gray-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-sm font-medium cursor-pointer">
                            Deployment guide →
                        </button>
                    </Link>
                </div>
            </section>

            {/* ── Stats ────────────────────────────────────────────── */}
            <section className="border-y border-gray-100 dark:border-purple-900/40 py-10 mb-28">
                <div className="max-w-3xl mx-auto grid grid-cols-4 divide-x divide-gray-100 dark:divide-purple-900/40 text-center px-4">
                    {[
                        { num: "12+", label: "Document Types" },
                        { num: "<2s", label: "Response Time" },
                        { num: "99%", label: "AI Accuracy" },
                        { num: "5k+", label: "Docs Analyzed" },
                    ].map((s) => (
                        <div key={s.label} className="px-4 md:px-8">
                            <div className="text-3xl md:text-4xl font-bold mb-1 text-purple-600 dark:text-purple-400 tabular-nums">{s.num}</div>
                            <div className="text-gray-500 text-xs mt-1">{s.label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Free Token Package ────────────────────────────────── */}
            <section className="max-w-5xl mx-auto px-4 mb-32">
                <div className="relative bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-950/60 dark:to-indigo-950/40 border border-purple-200 dark:border-purple-700/50 rounded-3xl p-10 md:p-14 overflow-hidden">
                    <div className="absolute top-0 right-0 w-72 h-72 bg-purple-400/10 dark:bg-purple-400/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                    <div className="relative grid grid-cols-1 lg:grid-cols-2 gap-10 items-center">
                        <div>
                            <span className="inline-flex items-center gap-2 bg-purple-100 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 text-xs font-semibold uppercase tracking-widest px-3 py-1 rounded-full mb-5">
                                <Sparkles className="w-3.5 h-3.5" /> Free for every team
                            </span>
                            <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                                10 million tokens<br />
                                <span className="text-purple-600 dark:text-purple-400">on the house</span>
                            </h2>
                            <p className="text-gray-600 dark:text-gray-400 text-lg mb-6 leading-relaxed">
                                Every new team gets 10M tokens free — enough to process hundreds of documents, run thousands of searches, and chat with your AI assistant without worrying about costs.
                            </p>
                            <Link href="/signup">
                                <button className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-7 py-3 rounded-full transition-colors text-base cursor-pointer flex items-center gap-2">
                                    Claim your free tokens <ArrowRight className="w-4 h-4" />
                                </button>
                            </Link>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {[
                                { label: "Document OCR", value: "~650 pages", desc: "Azure AI extraction" },
                                { label: "Embeddings", value: "10M tokens", desc: "Semantic indexing" },
                                { label: "AI Chat", value: "10M tokens", desc: "Ask anything" },
                                { label: "Search Rerank", value: "~50K queries", desc: "Smart result ranking" },
                                { label: "Entity Extraction", value: "~20K chunks", desc: "Auto-detect names, orgs, dates" },
                                { label: "Transcription", value: "~2K minutes", desc: "Audio to text" },
                            ].map((item) => (
                                <div key={item.label} className="bg-white/70 dark:bg-white/5 border border-purple-100 dark:border-purple-800/30 rounded-xl p-4">
                                    <div className="text-lg font-bold text-purple-600 dark:text-purple-400">{item.value}</div>
                                    <div className="text-sm font-semibold text-gray-900 dark:text-white mt-1">{item.label}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{item.desc}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Feature 1: Document RAG ───────────────────────────── */}
            <section className="max-w-6xl mx-auto px-4 mb-32">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
                    <div>
                        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-4">Document RAG</span>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                            AI that answers from<br />your documents, real‑time
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-lg mb-7 leading-relaxed">
                            Launchstack uses retrieval-augmented generation to give instant, cited answers from your uploaded documents — with page references and context-aware explanations.
                        </p>
                        <ul className="space-y-3 mb-8">
                            {[
                                "Semantic search across all company documents",
                                "Page-level citations with every answer",
                                "Predictive analysis spots missing documents",
                                "Bulk processing with automated categorization",
                            ].map((f) => (
                                <li key={f} className="flex items-center gap-3 text-gray-600 dark:text-gray-400 text-sm">
                                    <CheckCircle className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                    {f}
                                </li>
                            ))}
                        </ul>
                        <Link href="/signup">
                            <button className="flex items-center gap-2 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-semibold text-sm transition-colors cursor-pointer">
                                Try Document Q&A <ArrowRight className="w-4 h-4" />
                            </button>
                        </Link>
                    </div>
                    <DocRAGMockup />
                </div>
            </section>

            {/* ── Feature 2: Employee Management ───────────────────── */}
            <section className="max-w-6xl mx-auto px-4 mb-32">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
                    <EmployeeMockup />
                    <div>
                        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-4">Employee Management</span>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                            Role-based access for<br />your entire organization
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-lg mb-7 leading-relaxed">
                            Manage who can see and upload what — with approval workflows, invite codes, and detailed audit trails built for enterprise compliance.
                        </p>
                        <ul className="space-y-3 mb-8">
                            {[
                                "Invite employees with unique codes",
                                "Approve or reject access requests instantly",
                                "Granular role-based permissions per document",
                                "Full audit trail for every action",
                            ].map((f) => (
                                <li key={f} className="flex items-center gap-3 text-gray-600 dark:text-gray-400 text-sm">
                                    <CheckCircle className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                    {f}
                                </li>
                            ))}
                        </ul>
                        <Link href="/signup">
                            <button className="flex items-center gap-2 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-semibold text-sm transition-colors cursor-pointer">
                                Try Employee Management <ArrowRight className="w-4 h-4" />
                            </button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* ── Feature 3: Analytics ─────────────────────────────── */}
            <section className="max-w-6xl mx-auto px-4 mb-32">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
                    <div>
                        <span className="inline-block text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-4">Analytics</span>
                        <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                            Real-time insights into<br />your document ecosystem
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-lg mb-7 leading-relaxed">
                            Track document usage, AI accuracy, compliance gaps, and team productivity in one beautiful dashboard updated in real time.
                        </p>
                        <ul className="space-y-3 mb-8">
                            {[
                                "Document usage heatmaps & trends",
                                "AI accuracy and confidence tracking",
                                "Compliance gap detection reports",
                                "Exportable reports for stakeholders",
                            ].map((f) => (
                                <li key={f} className="flex items-center gap-3 text-gray-600 dark:text-gray-400 text-sm">
                                    <CheckCircle className="w-4 h-4 text-purple-500 flex-shrink-0" />
                                    {f}
                                </li>
                            ))}
                        </ul>
                        <Link href="/signup">
                            <button className="flex items-center gap-2 text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 font-semibold text-sm transition-colors cursor-pointer">
                                View Analytics <ArrowRight className="w-4 h-4" />
                            </button>
                        </Link>
                    </div>
                    <AnalyticsMockup />
                </div>
            </section>

            {/* ── Document Analysis Types ─────────────────────────── */}
            <section className="max-w-6xl mx-auto px-4 mb-32">
                <div className="text-center mb-14">
                    <span className="inline-block text-xs font-semibold uppercase tracking-widest text-purple-600 dark:text-purple-400 mb-4">Predictive Analysis</span>
                    <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                        Deep analysis across<br />8 document domains
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 text-lg max-w-2xl mx-auto leading-relaxed">
                        Launchstack detects missing references, compliance gaps, and actionable insights tailored to your specific document type.
                    </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                        { type: 'Contract', desc: 'Exhibits, schedules, addendums, and supporting agreements' },
                        { type: 'Financial', desc: 'Balance sheets, audit reports, and supporting statements' },
                        { type: 'Technical', desc: 'Specifications, manuals, diagrams, and deliverables' },
                        { type: 'Compliance', desc: 'Regulatory filings, certifications, and policy documents' },
                        { type: 'Educational', desc: 'Syllabi, handouts, readings, and linked resources' },
                        { type: 'HR', desc: 'Policies, forms, benefits materials, and handbooks' },
                        { type: 'Research', desc: 'Cited papers, datasets, and supplementary materials' },
                        { type: 'General', desc: 'Any document with cross-references and attachments' },
                    ].map((item) => (
                        <div
                            key={item.type}
                            className="bg-gray-50 dark:bg-purple-950/40 border border-gray-100 dark:border-purple-800/40 rounded-xl p-5 hover:border-purple-300 dark:hover:border-purple-600/60 transition-colors"
                        >
                            <h3 className="font-bold text-gray-900 dark:text-white text-sm mb-1.5">{item.type}</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-xs leading-relaxed">{item.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── How It Works ─────────────────────────────────────── */}
            <section className="border-y border-gray-100 dark:border-purple-900/40 py-28">
                <div className="max-w-4xl mx-auto px-4 text-center">
                    <p className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest mb-4 font-semibold">How it works</p>
                    <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                        Up and running in 3 steps
                    </h2>
                    <p className="text-gray-500 dark:text-gray-400 text-lg mb-16 max-w-lg mx-auto">
                        Deploy Launchstack with your own API keys in minutes.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                        {[
                            { n: "1", title: "Upload Documents", desc: "Drag and drop PDFs, contracts, reports, and more to your secure workspace.", icon: <Upload className="w-6 h-6" /> },
                            { n: "2", title: "AI Processes", desc: "Launchstack reads, categorizes, and builds a knowledge graph — automatically.", icon: <Sparkles className="w-6 h-6" /> },
                            { n: "3", title: "Get Answers", desc: "Ask questions, get cited summaries, and review compliance gaps instantly.", icon: <CheckCircle className="w-6 h-6" /> },
                        ].map((s) => (
                            <div key={s.n} className="text-center">
                                <div className="w-14 h-14 rounded-2xl bg-purple-100 dark:bg-purple-950/60 border border-purple-200 dark:border-purple-800/50 flex items-center justify-center mx-auto mb-5 text-purple-600 dark:text-purple-400">
                                    {s.icon}
                                </div>
                                <p className="text-purple-600 dark:text-purple-500 text-xs font-semibold uppercase tracking-widest mb-2">Step {s.n}</p>
                                <h3 className="text-lg font-bold mb-2">#{s.n} {s.title}</h3>
                                <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{s.desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Open Source / Deploy ──────────────────────────────── */}
            <section className="max-w-6xl mx-auto px-4 py-28">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
                    <div>
                        <p className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest mb-4 font-semibold">Open Source</p>
                        <h2 className="text-3xl md:text-4xl font-bold mb-5 leading-tight">
                            Fully open source.<br />Deploy anywhere.
                        </h2>
                        <p className="text-gray-500 dark:text-gray-400 text-lg mb-8 leading-relaxed">
                            Self-host Launchstack with your own API keys. This public site is a free demo — fork it, customize it, and run it on your own infrastructure.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-3">
                            <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">
                                <button className="flex items-center gap-2 bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold px-6 py-3 rounded-full hover:bg-gray-700 dark:hover:bg-gray-100 transition-colors text-sm cursor-pointer">
                                    <Github className="w-4 h-4" />
                                    View on GitHub
                                </button>
                            </a>
                            <Link href="/deployment">
                                <button className="flex items-center gap-2 border border-gray-200 dark:border-purple-700/50 text-gray-600 dark:text-gray-300 font-semibold px-6 py-3 rounded-full hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-sm cursor-pointer">
                                    <Code2 className="w-4 h-4" />
                                    Deployment Guide
                                </button>
                            </Link>
                        </div>
                    </div>

                    {/* Deploy options */}
                    <div className="space-y-3">
                        {[
                            { icon: "▲", name: "Deploy on Vercel", desc: "One-click deploy to Vercel with environment variable setup guide", href: "/deployment?section=vercel" },
                            { icon: "🐳", name: "Docker", desc: "Containerized deployment for any cloud or on-premise server", href: "/deployment?section=docker" },
                            { icon: "⚙️", name: "Self-hosted", desc: "Full control — run on your own servers with custom configuration", href: "/deployment?section=main" },
                        ].map((d) => (
                            <Link key={d.name} href={d.href}>
                                <div className="flex items-center gap-4 p-5 bg-gray-50 dark:bg-purple-950/40 border border-gray-100 dark:border-purple-800/40 rounded-xl hover:border-purple-300 dark:hover:border-purple-600/60 hover:bg-purple-50/60 dark:hover:bg-purple-900/30 transition-all duration-200 group cursor-pointer mb-3">
                                    <span className="text-xl w-8 flex-shrink-0">{d.icon}</span>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-semibold text-gray-900 dark:text-white text-sm group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">{d.name}</div>
                                        <div className="text-gray-500 dark:text-gray-400 text-xs mt-0.5 leading-snug">{d.desc}</div>
                                    </div>
                                    <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-500 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                            </Link>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── JHU Sponsorship ──────────────────────────────────── */}
            <section className="border-y border-gray-100 dark:border-purple-900/40 py-16">
                <div className="max-w-xl mx-auto px-4 text-center">
                    <div className="inline-flex items-center gap-2 text-sm text-gray-400 mb-6">
                        <Heart className="w-4 h-4 text-red-400" />
                        Proudly Sponsored By
                    </div>
                    <div className="flex items-center justify-center gap-5">
                        <Image
                            src="https://iiazjw8b8a.ufs.sh/f/zllPuoqtDQmM5spvD3EI3EhyDsbv87pB2AlOH1udg6mXVtkK"
                            alt="Johns Hopkins University"
                            width={52}
                            height={52}
                            className="rounded-xl"
                        />
                        <div className="text-left">
                            <div className="font-bold text-gray-900 dark:text-white text-base">Johns Hopkins University</div>
                            <div className="text-gray-500 text-sm">Advancing AI research for professionals worldwide</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ── Security Badges ───────────────────────────────────── */}
            <section className="py-16">
                <div className="max-w-3xl mx-auto px-4 text-center">
                    <p className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest mb-8 font-semibold">Security & Compliance</p>
                    <div className="flex flex-wrap justify-center gap-3">
                        {["SOC 2 Type II", "GDPR", "CCPA", "HIPAA", "Bank-level Encryption"].map((b) => (
                            <span key={b} className="border border-gray-200 dark:border-white/12 rounded-full py-2 px-5 text-sm font-medium text-gray-600 dark:text-gray-400">
                                {b}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── What is Launchstack (GEO-optimized) ─────────────── */}
            <section className="max-w-4xl mx-auto px-4 py-20">
                <div className="text-center mb-10">
                    <h2 className="text-3xl md:text-4xl font-bold mb-4 leading-tight">
                        What is Launchstack?
                    </h2>
                </div>
                <div className="prose prose-lg dark:prose-invert max-w-none text-gray-600 dark:text-gray-400 leading-relaxed space-y-4">
                    <p>
                        Launchstack is a free, open-source AI platform built specifically for tech founders who want to move fast without spending a fortune on SaaS tools. It brings together document analysis, predictive gap detection, team management, and marketing automation into a single platform that you can self-host on your own infrastructure.
                    </p>
                    <p>
                        Most startup tools lock you into expensive subscriptions before you have revenue. Launchstack takes a different approach. You bring your own API keys, deploy on Vercel or Docker, and get the same capabilities that enterprise teams pay thousands per month for. There are no usage limits, no hidden costs, and no vendor lock-in.
                    </p>
                    <p>
                        The platform supports over 12 document types across 8 domains, from contracts and compliance filings to financial statements and research papers. Its retrieval-augmented generation engine gives you cited answers with page references, while the predictive analysis system flags missing documents and compliance gaps before they become problems.
                    </p>
                </div>
            </section>

            {/* ── FAQ Section ─────────────────────────────────────── */}
            <section className="border-y border-gray-100 dark:border-purple-900/40 py-20">
                <div className="max-w-3xl mx-auto px-4">
                    <div className="text-center mb-14">
                        <p className="text-gray-400 dark:text-gray-500 text-xs uppercase tracking-widest mb-4 font-semibold">Frequently Asked Questions</p>
                        <h2 className="text-3xl md:text-4xl font-bold leading-tight">
                            Everything you need to know
                        </h2>
                    </div>
                    <div className="space-y-6">
                        {[
                            {
                                q: "Is Launchstack really free?",
                                a: "Yes, completely. Launchstack is open source under the MIT license. You can self-host it with your own API keys and pay nothing beyond your own infrastructure costs. There are no premium tiers, no feature gates, and no usage limits."
                            },
                            {
                                q: "How do I deploy Launchstack?",
                                a: "You can deploy Launchstack on Vercel with one click, run it in Docker containers, or set it up on any server you control. The deployment guide walks you through every step, and most founders have it running in under 30 minutes."
                            },
                            {
                                q: "What makes Launchstack different from other document AI tools?",
                                a: "Two things. First, it is completely free and open source — you will never get a surprise invoice. Second, it goes beyond basic document Q&A by combining predictive gap detection, team management, analytics, and marketing tools into one platform. Most alternatives only do one of those things and charge you monthly for it."
                            },
                            {
                                q: "Do I need my own API keys?",
                                a: "Yes. Launchstack uses your own OpenAI, Anthropic, or Google AI keys for the AI features. This means you are not locked into our pricing and you maintain full control over your AI usage and costs."
                            },
                            {
                                q: "Can I use Launchstack for my startup right now?",
                                a: "Absolutely. Launchstack is production-ready and already used by teams for contract analysis, compliance checking, and document management. You can also try the free demo on this site before deploying your own instance."
                            },
                        ].map((item) => (
                            <div
                                key={item.q}
                                className="bg-gray-50 dark:bg-purple-950/30 border border-gray-100 dark:border-purple-800/40 rounded-xl p-6"
                            >
                                <div className="flex items-start gap-3">
                                    <HelpCircle className="w-5 h-5 text-purple-500 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <h3 className="font-bold text-gray-900 dark:text-white text-base mb-2">{item.q}</h3>
                                        <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed">{item.a}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Final CTA ─────────────────────────────────────────── */}
            <section className="relative py-36 text-center px-4">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_50%_100%,rgba(147,51,234,0.1),transparent)] dark:bg-[radial-gradient(ellipse_60%_50%_at_50%_100%,rgba(147,51,234,0.18),transparent)] pointer-events-none" />
                <h2 className="text-4xl md:text-6xl font-bold mb-5 leading-tight relative">
                    Document AI that helps<br />
                    <span className="text-purple-600 dark:text-purple-400">during analysis, not after.</span>
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-lg mb-10 max-w-md mx-auto relative">
                    Try Launchstack free on your next document today.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 items-center justify-center relative">
                    <Link href="/signup">
                        <button className="bg-purple-600 hover:bg-purple-700 text-white font-semibold px-8 py-3.5 rounded-full transition-colors text-base cursor-pointer">
                            Try it out for free
                        </button>
                    </Link>
                    <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer">
                        <button className="flex items-center gap-2 text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors text-base font-medium cursor-pointer">
                            <Github className="w-4 h-4" />
                            Deploy yourself
                        </button>
                    </a>
                </div>
            </section>

            {/* ── Footer ────────────────────────────────────────────── */}
            <footer className="border-t border-gray-100 dark:border-purple-900/40 py-12">
                <div className="max-w-6xl mx-auto px-4 flex flex-col md:flex-row justify-between items-center gap-6">
                    <div className="flex items-center gap-2">
                        <LaunchstackMark size={22} title="Launchstack" />
                        <span className="font-bold text-gray-900 dark:text-white">Launchstack</span>
                    </div>
                    <div className="flex gap-8 text-sm text-gray-500">
                        <Link href="/pricing" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">Pricing</Link>
                        <Link href="/deployment" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">Deployment</Link>
                        <Link href="/contact" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors">Contact</Link>
                        <a href={GITHUB_REPO} target="_blank" rel="noopener noreferrer" className="hover:text-purple-600 dark:hover:text-purple-400 transition-colors flex items-center gap-1.5">
                            <Github className="w-3.5 h-3.5" /> GitHub
                        </a>
                    </div>
                    <p className="text-gray-400 dark:text-gray-500 text-sm">© 2026 Launchstack. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
}

/* ── App Mockup Components ──────────────────────────────────────────── */

function DocRAGMockup() {
    return (
        <div className="bg-white dark:bg-[#0d0018] border border-gray-200 dark:border-purple-800/40 rounded-2xl overflow-hidden shadow-xl shadow-purple-100/50 dark:shadow-purple-950/30">
            <MockupChrome label="Document Q&A" />
            <div className="flex" style={{ height: 280 }}>
                {/* Doc list sidebar */}
                <div className="w-2/5 border-r border-gray-100 dark:border-purple-800/30 p-4 flex flex-col gap-1.5">
                    <div className="text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wide">Documents</div>
                    {[
                        { name: "Policy Manual.pdf", pages: "24 pages", active: true },
                        { name: "Safety Protocol.pdf", pages: "12 pages", active: false },
                        { name: "Compliance 2024.pdf", pages: "38 pages", active: false },
                    ].map((d) => (
                        <div
                            key={d.name}
                            className={`flex items-start gap-2 p-2 rounded-lg text-xs cursor-default ${d.active
                                ? "bg-purple-100 dark:bg-purple-900/40 border border-purple-200 dark:border-purple-700/50"
                                : "hover:bg-gray-50 dark:hover:bg-white/5"}`}
                        >
                            <FileSearch className="w-3 h-3 text-purple-500 flex-shrink-0 mt-0.5" />
                            <div>
                                <div className="font-medium text-gray-800 dark:text-gray-200 leading-snug">{d.name}</div>
                                <div className="text-gray-400 dark:text-gray-500">{d.pages}</div>
                            </div>
                        </div>
                    ))}
                </div>

                {/* Chat area */}
                <div className="flex-1 flex flex-col">
                    <div className="flex-1 p-4 space-y-3 overflow-hidden">
                        <div className="flex justify-end">
                            <div className="bg-purple-600 text-white text-xs rounded-2xl rounded-tr-sm px-3 py-2 max-w-[82%]">
                                What are the key safety requirements?
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <div className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                                <Brain className="w-3 h-3 text-white" />
                            </div>
                            <div className="bg-gray-50 dark:bg-purple-950/50 border border-gray-100 dark:border-purple-800/40 text-xs rounded-2xl rounded-tl-sm px-3 py-2 max-w-[82%] text-gray-700 dark:text-gray-200 leading-relaxed">
                                Based on <span className="text-purple-600 dark:text-purple-400 font-medium">Policy Manual p.8</span>, requirements are: (1) PPE required in Zone A, (2) mandatory safety briefing before entry, (3) sign-off from department lead...
                            </div>
                        </div>
                    </div>
                    <div className="p-3 border-t border-gray-100 dark:border-purple-800/30">
                        <div className="flex items-center gap-2 bg-gray-50 dark:bg-purple-950/40 border border-gray-100 dark:border-purple-800/30 rounded-xl px-3 py-2">
                            <span className="text-xs text-gray-400 flex-1">Ask anything about your documents...</span>
                            <ArrowRight className="w-3 h-3 text-purple-400" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function EmployeeMockup() {
    const employees = [
        { name: "Sarah Chen", role: "Admin", status: "Active", initials: "SC", color: "bg-purple-500" },
        { name: "James Park", role: "Viewer", status: "Active", initials: "JP", color: "bg-blue-500" },
        { name: "Maria Torres", role: "Analyst", status: "Pending", initials: "MT", color: "bg-green-500" },
        { name: "David Kim", role: "Viewer", status: "Pending", initials: "DK", color: "bg-orange-500" },
    ];

    return (
        <div className="bg-white dark:bg-[#0d0018] border border-gray-200 dark:border-purple-800/40 rounded-2xl overflow-hidden shadow-xl shadow-purple-100/50 dark:shadow-purple-950/30">
            <MockupChrome label="Employee Management" />
            <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                    <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Team Members · {employees.length}</span>
                    <button className="text-xs bg-purple-600 text-white px-3 py-1 rounded-full font-medium">+ Invite</button>
                </div>
                <div className="space-y-2">
                    {employees.map((e) => (
                        <div key={e.name} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-purple-950/40 border border-gray-100 dark:border-purple-800/30 rounded-xl">
                            <div className={`w-8 h-8 rounded-full ${e.color} flex items-center justify-center text-white text-xs font-bold flex-shrink-0`}>
                                {e.initials}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold text-gray-800 dark:text-gray-200">{e.name}</div>
                                <div className="text-xs text-gray-400 dark:text-gray-500">{e.role}</div>
                            </div>
                            <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${e.status === "Active"
                                ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                                : "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400"}`}>
                                {e.status}
                            </span>
                            {e.status === "Pending" && (
                                <button className="text-xs bg-purple-600 text-white px-2.5 py-0.5 rounded-full font-medium">Approve</button>
                            )}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

function AnalyticsMockup() {
    const bars = [
        { label: "Mon", pct: 62 },
        { label: "Tue", pct: 88 },
        { label: "Wed", pct: 47 },
        { label: "Thu", pct: 95 },
        { label: "Fri", pct: 73 },
        { label: "Sat", pct: 32 },
        { label: "Sun", pct: 58 },
    ];

    return (
        <div className="bg-white dark:bg-[#0d0018] border border-gray-200 dark:border-purple-800/40 rounded-2xl overflow-hidden shadow-xl shadow-purple-100/50 dark:shadow-purple-950/30">
            <MockupChrome label="Analytics Dashboard" />
            <div className="p-5">
                {/* Stat cards */}
                <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                        { label: "Documents", value: "247", change: "+12%" },
                        { label: "Queries", value: "1,834", change: "+28%" },
                        { label: "Accuracy", value: "99.1%", change: "+0.3%" },
                    ].map((s) => (
                        <div key={s.label} className="bg-gray-50 dark:bg-purple-950/40 border border-gray-100 dark:border-purple-800/30 rounded-xl p-3">
                            <div className="text-base font-bold text-gray-900 dark:text-white tabular-nums">{s.value}</div>
                            <div className="text-xs text-gray-500 dark:text-gray-500">{s.label}</div>
                            <div className="text-xs text-green-500 font-semibold mt-0.5">{s.change}</div>
                        </div>
                    ))}
                </div>

                {/* Bar chart */}
                <div className="bg-gray-50 dark:bg-purple-950/40 border border-gray-100 dark:border-purple-800/30 rounded-xl p-4">
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-3 font-semibold uppercase tracking-wide">Document Queries — This Week</div>
                    <div className="flex items-end justify-between gap-1.5 h-20">
                        {bars.map((b) => (
                            <div key={b.label} className="flex-1 flex flex-col items-center gap-1">
                                <div
                                    className="w-full bg-purple-500 dark:bg-purple-600 rounded-t-sm opacity-80 hover:opacity-100 transition-opacity"
                                    style={{ height: `${b.pct}%` }}
                                />
                                <span className="text-xs text-gray-400 dark:text-gray-500">{b.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}

function MockupChrome({ label }: { label: string }) {
    return (
        <div className="flex items-center gap-1.5 px-4 py-3 bg-gray-50 dark:bg-purple-950/50 border-b border-gray-100 dark:border-purple-800/30">
            <div className="w-2.5 h-2.5 rounded-full bg-red-400/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-green-400/70" />
            <span className="ml-3 text-xs text-gray-400 dark:text-gray-500 font-mono">{label}</span>
        </div>
    );
}
