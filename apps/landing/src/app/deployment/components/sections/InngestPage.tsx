"use client";

import React from "react";
import { motion } from "motion/react";
import { Layers, Zap, RefreshCw, Clock, Shield, BarChart3, CheckCircle2 } from "lucide-react";
import type { DeploymentProps } from "../../types";
import { Section, CodeBlock, Step, ApiKeyCard, InfoBox, WarningBox } from "../ui";

export const InngestPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
    const darkMode = false;
    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="mb-16"
            >
                <div
                    className={`inline-flex items-center gap-2 px-4 py-2 ${
                        darkMode
                            ? "bg-emerald-900/50 text-emerald-300"
                            : "bg-emerald-100 text-emerald-700"
                    } mb-6 rounded-full text-sm font-medium`}
                >
                    <Layers className="h-4 w-4" />
                    Required Integration
                </div>

                <h1 className="mb-6 bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-5xl font-bold text-transparent">
                    Inngest Background Jobs
                </h1>

                <p className={`text-xl ${darkMode ? "text-gray-300" : "text-gray-600"} mb-6`}>
                    Reliable background processing for document OCR pipelines with automatic
                    retries, observability, and step-based execution.
                </p>
            </motion.div>

            {/* Benefits */}
            <Section title="Why Inngest?">
                <div className="grid gap-6 md:grid-cols-2">
                    <BenefitCard
                        icon={<RefreshCw className="h-6 w-6" />}
                        title="Automatic Retries"
                        description="Failed steps automatically retry with exponential backoff. No lost documents due to transient failures."
                    />
                    <BenefitCard
                        icon={<Layers className="h-6 w-6" />}
                        title="Step-Based Execution"
                        description="Each pipeline step (Router → OCR → Chunking → Vectorize → Store) runs independently. Failures only retry the failed step."
                    />
                    <BenefitCard
                        icon={<Clock className="h-6 w-6" />}
                        title="Long-Running Jobs"
                        description="Process large documents without timeout limits. Inngest handles jobs that take minutes or hours."
                    />
                    <BenefitCard
                        icon={<BarChart3 className="h-6 w-6" />}
                        title="Observability Dashboard"
                        description="Visual timeline of every job, step durations, error logs, and retry history in one dashboard."
                    />
                    <BenefitCard
                        icon={<Shield className="h-6 w-6" />}
                        title="Rate Limiting & Concurrency"
                        description="Control how many documents process simultaneously. Prevent overwhelming external APIs."
                    />
                    <BenefitCard
                        icon={<Zap className="h-6 w-6" />}
                        title="Vercel Integration"
                        description="One-click setup with Vercel. Auto-configures keys and endpoints."
                    />
                </div>
            </Section>

            {/* How the Pipeline Works */}
            <Section title="How the Pipeline Works">
                <div
                    className={`rounded-xl p-6 ${
                        darkMode
                            ? "border border-gray-700 bg-gray-800/50"
                            : "border border-gray-200 bg-gray-50"
                    }`}
                >
                    <div className="space-y-4">
                        <PipelineStep
                            step="A"
                            title="Router"
                            description="Analyzes PDF to determine: native text extraction or OCR needed? Which provider (Azure, Landing.AI)?"
                        />
                        <PipelineStep
                            step="B"
                            title="Normalize"
                            description="Extracts content using the selected provider. Outputs standardized PageContent[] structure."
                        />
                        <PipelineStep
                            step="C"
                            title="Chunking"
                            description="Splits pages into semantic chunks (500 tokens, 50 overlap). Separates tables from text."
                        />
                        <PipelineStep
                            step="D"
                            title="Vectorize"
                            description="Generates embeddings via the configured embedding index — text-embedding-3-large at 1536 dimensions by default."
                        />
                        <PipelineStep
                            step="E"
                            title="Storage"
                            description="Persists chunks with vectors to PostgreSQL. Updates document and job status."
                        />
                    </div>
                </div>
            </Section>

            {/* Development Setup */}
            <Section title="Development Setup">
                <InfoBox
                    title="The worker hosts the Inngest endpoint"
                    icon={<Zap className="h-5 w-5" />}
                >
                    <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                        Since ADR-003, durable functions are served by the background worker at{" "}
                        <code
                            className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-emerald-300" : "bg-gray-100 text-emerald-700"}`}
                        >
                            http://localhost:8020/api/inngest
                        </code>{" "}
                        — not by the Next.js app. The Next.js app only sends events. The Docker
                        Compose stack starts the worker and an{" "}
                        <code
                            className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-emerald-300" : "bg-gray-100 text-emerald-700"}`}
                        >
                            inngest-dev
                        </code>{" "}
                        server already pointed at it.
                    </p>
                    <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}>
                        The Inngest dev server dashboard is available at{" "}
                        <code
                            className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-emerald-300" : "bg-gray-100 text-emerald-700"}`}
                        >
                            http://localhost:8288
                        </code>{" "}
                        where you can monitor jobs, view step execution, and inspect logs.
                    </p>
                </InfoBox>

                <div className="mt-8 space-y-6">
                    <div>
                        <h3
                            className={`mb-3 text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Start the stack (worker + Inngest dev server included)
                        </h3>
                        <CodeBlock
                            code="docker compose --env-file .env up"
                            onCopy={() =>
                                copyToClipboard("docker compose --env-file .env up", "inngest-dev")
                            }
                            copied={copiedCode === "inngest-dev"}
                        />
                        <p
                            className={`mt-2 text-sm ${darkMode ? "text-gray-400" : "text-gray-500"}`}
                        >
                            Running outside Docker? Start the worker, then point the Inngest CLI at
                            it:
                        </p>
                        <CodeBlock
                            code={`pnpm --filter @launchstack/worker dev
pnpm dlx inngest-cli@latest dev -u http://localhost:8020/api/inngest`}
                            onCopy={() =>
                                copyToClipboard(
                                    "pnpm --filter @launchstack/worker dev\npnpm dlx inngest-cli@latest dev -u http://localhost:8020/api/inngest",
                                    "inngest-dev-full"
                                )
                            }
                            copied={copiedCode === "inngest-dev-full"}
                        />
                    </div>

                    <div>
                        <h3
                            className={`mb-3 text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            INNGEST_EVENT_KEY in development
                        </h3>
                        <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                            The Inngest dev server does <strong>not</strong> require a real event
                            key. You can use any placeholder value in your{" "}
                            <code
                                className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-emerald-300" : "bg-gray-100 text-emerald-700"}`}
                            >
                                .env
                            </code>{" "}
                            file:
                        </p>
                        <CodeBlock
                            code={`# Placeholder — the Inngest dev server accepts any value
INNGEST_EVENT_KEY=dev-placeholder`}
                            onCopy={() =>
                                copyToClipboard(
                                    "INNGEST_EVENT_KEY=dev-placeholder",
                                    "inngest-dev-key"
                                )
                            }
                            copied={copiedCode === "inngest-dev-key"}
                        />
                        <WarningBox
                            title="Required at startup"
                            description="INNGEST_EVENT_KEY must be set to a non-empty value or the app will throw an error on startup. In development, any placeholder string works fine."
                        />
                    </div>
                </div>
            </Section>

            {/* Production Setup */}
            <Section title="Production Setup">
                <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-6`}>
                    In production, Inngest Cloud handles job scheduling, retries, and monitoring.
                    You need a real event key and signing key from your Inngest account. Register
                    the <strong>worker&apos;s</strong> public URL (
                    <code
                        className={`rounded px-1 py-0.5 text-xs ${darkMode ? "bg-gray-800" : "bg-gray-100"}`}
                    >
                        https://&lt;worker-host&gt;/api/inngest
                    </code>
                    ) as the app endpoint — the Next.js app no longer serves one.
                </p>

                <div className="space-y-6">
                    <ApiKeyCard
                        title="Option 1: Vercel Integration (Recommended)"
                        link="https://vercel.com/integrations/inngest"
                        description="One-click setup that auto-configures environment variables"
                        steps={[
                            "Go to Vercel Dashboard → Integrations",
                            'Search for "Inngest" and click Install',
                            "Authorize and select your project",
                            "Environment variables are automatically added",
                            "Redeploy your application",
                        ]}
                    />

                    <ApiKeyCard
                        title="Option 2: Manual Configuration"
                        link="https://inngest.com"
                        description="For non-Vercel deployments or custom setups"
                        steps={[
                            "Create account at inngest.com",
                            "Create a new app in the dashboard",
                            "Go to Settings → Event Keys → Create Key",
                            "Copy INNGEST_EVENT_KEY to your environment",
                            "Go to Settings → Signing Key",
                            "Copy INNGEST_SIGNING_KEY to your environment",
                        ]}
                    />
                </div>

                <div className="mt-8">
                    <Step
                        number={1}
                        title="Add Environment Variables"
                        description="Add these to your production environment:"
                        code={`# Required for production
INNGEST_EVENT_KEY=your_real_event_key
INNGEST_SIGNING_KEY=signkey-prod-xxxxx`}
                        onCopy={() =>
                            copyToClipboard(
                                `INNGEST_EVENT_KEY=your_real_event_key\nINNGEST_SIGNING_KEY=signkey-prod-xxxxx`,
                                "inngest-prod-env"
                            )
                        }
                        copied={copiedCode === "inngest-prod-env"}
                    />
                </div>
            </Section>

            {/* Architecture Diagram */}
            <Section title="Architecture">
                <div className="rounded-xl bg-gray-900 p-6 font-mono text-sm text-gray-300">
                    <pre className="overflow-x-auto">
                        {`┌─────────────────────────────────────────────────────────────┐
│                    Document Upload                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              triggerDocumentProcessing()                    │
│  Sends event to Inngest (requires INNGEST_EVENT_KEY)       │
└────────────────────────────┬────────────────────────────────┘
                             │
              ┌──────────────┴──────────────┐
              │  Dev: local Inngest server  │
              │  Prod: Inngest Cloud        │
              └──────────────┬──────────────┘
                             │
                             ▼ (functions served by the worker
                                at :8020/api/inngest — ADR-003)
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐│
│  │ Step A  │→│ Step B  │→│ Step C  │→│ Step D  │→│ Step E││
│  │ Router  │ │Normalize│ │ Chunk   │ │Vectorize│ │ Store ││
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘│
│                                                             │
│  ✓ Automatic retries    ✓ Step isolation    ✓ Observability │
└─────────────────────────────────────────────────────────────┘`}
                    </pre>
                </div>
            </Section>

            {/* Verify */}
            <Section title="Verify Setup">
                <div className="space-y-4">
                    <VerificationStep text="Run docker compose up — app, worker, and Inngest dev server start" />
                    <VerificationStep text="Open http://localhost:8288 — Inngest dashboard shows 'pdr-ai' app (synced from the worker)" />
                    <VerificationStep text="Upload a document — the ingestion pipeline appears in the dashboard" />
                    <VerificationStep text="View step-by-step execution and logs in the Inngest timeline" />
                </div>
            </Section>

            {/* Troubleshooting */}
            <Section title="Troubleshooting">
                <div className="space-y-4">
                    <div
                        className={`rounded-xl p-4 ${darkMode ? "border border-gray-700 bg-gray-800/50" : "border border-gray-200 bg-gray-50"}`}
                    >
                        <h4
                            className={`mb-1 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            App crashes with &quot;INNGEST_EVENT_KEY is required in production&quot;
                        </h4>
                        <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                            Set{" "}
                            <code
                                className={`rounded px-1 py-0.5 text-xs ${darkMode ? "bg-gray-800" : "bg-gray-100"}`}
                            >
                                INNGEST_EVENT_KEY=dev-placeholder
                            </code>{" "}
                            in your{" "}
                            <code
                                className={`rounded px-1 py-0.5 text-xs ${darkMode ? "bg-gray-800" : "bg-gray-100"}`}
                            >
                                .env
                            </code>{" "}
                            file. Any non-empty value works for local development.
                        </p>
                    </div>
                    <div
                        className={`rounded-xl p-4 ${darkMode ? "border border-gray-700 bg-gray-800/50" : "border border-gray-200 bg-gray-50"}`}
                    >
                        <h4
                            className={`mb-1 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Inngest dashboard shows no functions
                        </h4>
                        <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                            Make sure the worker is running and the Inngest dev server can reach{" "}
                            <code
                                className={`rounded px-1 py-0.5 text-xs ${darkMode ? "bg-gray-800" : "bg-gray-100"}`}
                            >
                                http://localhost:8020/api/inngest
                            </code>{" "}
                            (inside Compose:{" "}
                            <code
                                className={`rounded px-1 py-0.5 text-xs ${darkMode ? "bg-gray-800" : "bg-gray-100"}`}
                            >
                                http://worker:8020/api/inngest
                            </code>
                            ). The Next.js app does not serve Inngest functions.
                        </p>
                    </div>
                    <div
                        className={`rounded-xl p-4 ${darkMode ? "border border-gray-700 bg-gray-800/50" : "border border-gray-200 bg-gray-50"}`}
                    >
                        <h4
                            className={`mb-1 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Uploads stay queued and never process
                        </h4>
                        <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                            Ingestion is executed by the worker, which consumes the transactional
                            outbox. If the worker isn&apos;t running, uploads are accepted but never
                            processed — check{" "}
                            <code
                                className={`rounded px-1 py-0.5 text-xs ${darkMode ? "bg-gray-800" : "bg-gray-100"}`}
                            >
                                curl http://localhost:8020/healthz
                            </code>
                            .
                        </p>
                    </div>
                </div>
            </Section>
        </>
    );
};

// --- Helper Components ---

interface BenefitCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
}

const BenefitCard: React.FC<BenefitCardProps> = ({ icon, title, description }) => {
    const darkMode = false;
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`rounded-xl border p-5 ${
                darkMode
                    ? "border-gray-700 bg-gray-800/50 hover:border-emerald-600/50"
                    : "border-gray-200 bg-white hover:border-emerald-400"
            } transition-colors`}
        >
            <div className={`mb-3 ${darkMode ? "text-emerald-400" : "text-emerald-600"}`}>
                {icon}
            </div>
            <h3 className={`mb-2 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
                {title}
            </h3>
            <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                {description}
            </p>
        </motion.div>
    );
};

interface PipelineStepProps {
    step: string;
    title: string;
    description: string;
}

const PipelineStep: React.FC<PipelineStepProps> = ({ step, title, description }) => {
    const darkMode = false;
    return (
        <div className="flex items-start gap-4">
            <div
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                    darkMode
                        ? "bg-emerald-900/50 text-emerald-400"
                        : "bg-emerald-100 text-emerald-700"
                }`}
            >
                {step}
            </div>
            <div>
                <h4 className={`font-medium ${darkMode ? "text-white" : "text-gray-900"}`}>
                    {title}
                </h4>
                <p className={`text-sm ${darkMode ? "text-gray-400" : "text-gray-600"}`}>
                    {description}
                </p>
            </div>
        </div>
    );
};

interface VerificationStepProps {
    text: string;
}

const VerificationStep: React.FC<VerificationStepProps> = ({ text }) => {
    const darkMode = false;
    return (
        <div className="flex items-center gap-3">
            <CheckCircle2
                className={`h-5 w-5 ${darkMode ? "text-emerald-400" : "text-emerald-600"}`}
            />
            <span className={darkMode ? "text-gray-300" : "text-gray-700"}>{text}</span>
        </div>
    );
};
