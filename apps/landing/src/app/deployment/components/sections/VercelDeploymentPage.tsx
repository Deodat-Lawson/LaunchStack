"use client";

import React from "react";
import { motion } from "motion/react";
import { Rocket, Database, Settings, Globe, ShieldAlert, ExternalLink } from "lucide-react";
import type { DeploymentProps } from "../../types";
import { Section, Step } from "../ui";

/* ── Inline components (shared design language) ── */

interface StepCardProps {
    icon: React.ReactNode;
    title: string;
    children: React.ReactNode;
}

const StepCard: React.FC<StepCardProps> = ({ icon, title, children }) => {
    const darkMode = false;
    return (
        <div
            className={`flex items-start gap-4 rounded-xl border p-5 transition-all duration-200 ${
                darkMode
                    ? "border-gray-700/60 bg-gray-800/60 hover:border-purple-500/40"
                    : "border-gray-200 bg-white hover:border-purple-300 hover:shadow-md"
            }`}
        >
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 text-white shadow-lg shadow-purple-500/20">
                {icon}
            </div>
            <div className="min-w-0 flex-1">
                <h3 className={`mb-1 font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}>
                    {title}
                </h3>
                <div
                    className={`text-sm leading-relaxed ${darkMode ? "text-gray-400" : "text-gray-600"}`}
                >
                    {children}
                </div>
            </div>
        </div>
    );
};

interface CalloutProps {
    icon: React.ReactNode;

    variant?: "info" | "warning";
    children: React.ReactNode;
}

const Callout: React.FC<CalloutProps> = ({ icon, variant = "info", children }) => {
    const darkMode = false;
    const colors = {
        info: darkMode
            ? "bg-purple-900/20 border-purple-800/50 text-purple-300"
            : "bg-purple-50 border-purple-200 text-purple-800",
        warning: darkMode
            ? "bg-yellow-900/20 border-yellow-800/50 text-yellow-300"
            : "bg-yellow-50 border-yellow-200 text-yellow-800",
    };

    return (
        <div
            className={`flex items-start gap-3 rounded-xl border p-4 text-sm leading-relaxed ${colors[variant]}`}
        >
            <div className="mt-0.5 flex-shrink-0">{icon}</div>
            <div>{children}</div>
        </div>
    );
};

const Divider: React.FC = () => {
    const darkMode = false;
    return <hr className={`my-12 border-t ${darkMode ? "border-gray-800" : "border-gray-200"}`} />;
};

/* ── Page ── */

export const VercelDeploymentPage: React.FC<DeploymentProps> = ({
    copyToClipboard,
    copiedCode,
}) => {
    const darkMode = false;
    return (
        <>
            {/* ── Hero ── */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="mb-12"
            >
                <h1 className="mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-5xl font-bold text-transparent">
                    Vercel Deployment
                </h1>
                <p
                    className={`max-w-2xl text-xl leading-relaxed ${darkMode ? "text-gray-300" : "text-gray-600"}`}
                >
                    Deploy Launchstack with managed hosting from Vercel. Connect your GitHub
                    repository, add environment variables, and go live with zero infrastructure to
                    maintain.
                </p>
            </motion.div>

            <Divider />

            {/* ── How it works ── */}
            <Section
                title="How it works"
                subtitle="Vercel handles builds and hosting. You provide the database and API keys."
            >
                <div className="space-y-3">
                    <StepCard icon={<Rocket className="h-5 w-5" />} title="Fork and import">
                        First, fork{" "}
                        <a
                            href="https://github.com/Deodat-Lawson/LaunchStack/fork"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-purple-500 hover:underline"
                        >
                            Deodat-Lawson/LaunchStack <ExternalLink className="h-3 w-3" />
                        </a>{" "}
                        to your own GitHub account. Then create a new Vercel project at{" "}
                        <a
                            href="https://vercel.com/new"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-purple-500 hover:underline"
                        >
                            vercel.com/new <ExternalLink className="h-3 w-3" />
                        </a>{" "}
                        and import your fork. Vercel auto-detects Next.js and configures builds.
                    </StepCard>
                    <StepCard
                        icon={<Database className="h-5 w-5" />}
                        title="Neon serverless database"
                    >
                        Use{" "}
                        <a
                            href="https://neon.tech"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-purple-500 hover:underline"
                        >
                            Neon <ExternalLink className="h-3 w-3" />
                        </a>{" "}
                        for managed PostgreSQL with pgvector. Paste the connection string as{" "}
                        <code
                            className={`${darkMode ? "bg-gray-900" : "bg-gray-100"} rounded px-1 py-0.5 text-xs`}
                        >
                            DATABASE_URL
                        </code>
                        .
                    </StepCard>
                    <StepCard icon={<Settings className="h-5 w-5" />} title="Environment variables">
                        Set all required keys in{" "}
                        <strong>Project Settings → Environment Variables</strong> for Production
                        (and Preview if needed).
                    </StepCard>
                </div>
            </Section>

            {/* ── Step-by-step ── */}
            <Section title="Step-by-step setup">
                <div className="space-y-6">
                    <Step
                        number={1}
                        title="Fork the repository"
                        description="Go to the Launchstack repo and click Fork to create a copy under your GitHub account."
                        onCopy={() =>
                            copyToClipboard(
                                "https://github.com/Deodat-Lawson/LaunchStack/fork",
                                "v-1a"
                            )
                        }
                        copied={copiedCode === "v-1a"}
                    >
                        <a
                            href="https://github.com/Deodat-Lawson/LaunchStack/fork"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-medium text-purple-500 hover:text-purple-400 hover:underline"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            github.com/Deodat-Lawson/LaunchStack/fork
                        </a>
                    </Step>

                    <Step
                        number={2}
                        title="Create a new Vercel project"
                        description="Select your fork, choose Next.js, and set Root Directory to apps/web so Vercel uses apps/web/vercel.json."
                        onCopy={() => copyToClipboard("https://vercel.com/new", "v-1b")}
                        copied={copiedCode === "v-1b"}
                    >
                        <a
                            href="https://vercel.com/new"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-medium text-purple-500 hover:text-purple-400 hover:underline"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            vercel.com/new
                        </a>
                    </Step>

                    <Step
                        number={3}
                        title="Add environment variables"
                        description="Paste these into Vercel's Environment Variables panel before the first deploy. BLOB_READ_WRITE_TOKEN is auto-injected when you connect a Blob store (see below)."
                        code={`DATABASE_URL=postgresql://<neon-connection-string>
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>
CLERK_SECRET_KEY=<your-clerk-secret-key>
CHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CHAT_API_KEY=<your-google-ai-key>
INNGEST_EVENT_KEY=<your-inngest-event-key>
BLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>`}
                        onCopy={() =>
                            copyToClipboard(
                                `DATABASE_URL=postgresql://<neon-connection-string>\nNEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>\nCLERK_SECRET_KEY=<your-clerk-secret-key>\nCHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai\nCHAT_API_KEY=<your-google-ai-key>\nINNGEST_EVENT_KEY=<your-inngest-event-key>\nBLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>`,
                                "v-2"
                            )
                        }
                        copied={copiedCode === "v-2"}
                    />

                    <Step
                        number={4}
                        title="Create a Vercel Blob store"
                        description="Go to your Vercel project → Storage → Create Database → Blob. Connect it to your project — this auto-injects BLOB_READ_WRITE_TOKEN. Document uploads will fail without this."
                        onCopy={() => copyToClipboard("https://vercel.com/dashboard", "v-blob")}
                        copied={copiedCode === "v-blob"}
                    >
                        <a
                            href="https://vercel.com/dashboard"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-medium text-purple-500 hover:text-purple-400 hover:underline"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Vercel Dashboard → Storage
                        </a>
                    </Step>

                    <Step
                        number={5}
                        title="Deploy"
                        description="Click Deploy in your Vercel project dashboard. Vercel builds and publishes the app automatically."
                        onCopy={() => copyToClipboard("https://vercel.com/dashboard", "v-3")}
                        copied={copiedCode === "v-3"}
                    >
                        <a
                            href="https://vercel.com/dashboard"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-medium text-purple-500 hover:text-purple-400 hover:underline"
                        >
                            <ExternalLink className="h-3.5 w-3.5" />
                            vercel.com/dashboard
                        </a>
                    </Step>

                    <Step
                        number={6}
                        title="Validate"
                        description="Open your production domain and confirm these routes work:"
                        onCopy={() =>
                            copyToClipboard(
                                "https://your-app.vercel.app\nhttps://your-app.vercel.app/sign-in\nhttps://your-app.vercel.app/dashboard",
                                "v-4"
                            )
                        }
                        copied={copiedCode === "v-4"}
                    >
                        <div className="space-y-1">
                            <div>
                                <code className="text-sm text-purple-500">your-app.vercel.app</code>
                            </div>
                            <div>
                                <code className="text-sm text-purple-500">
                                    your-app.vercel.app/sign-in
                                </code>
                            </div>
                            <div>
                                <code className="text-sm text-purple-500">
                                    your-app.vercel.app/dashboard
                                </code>
                            </div>
                        </div>
                    </Step>
                </div>
            </Section>

            <Divider />

            {/* ── Post-deploy checklist ── */}
            <Section title="Post-deploy checklist">
                <div
                    className={`overflow-hidden rounded-xl border ${darkMode ? "border-gray-700/60" : "border-gray-200"}`}
                >
                    <table className="w-full text-sm">
                        <thead>
                            <tr className={darkMode ? "bg-gray-800/80" : "bg-gray-50"}>
                                <th
                                    className={`px-4 py-3 text-left font-semibold ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                                >
                                    Check
                                </th>
                                <th
                                    className={`px-4 py-3 text-left font-semibold ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                                >
                                    How to verify
                                </th>
                            </tr>
                        </thead>
                        <tbody
                            className={`divide-y ${darkMode ? "divide-gray-700/60" : "divide-gray-200"}`}
                        >
                            {[
                                ["Auth works", "Sign in and sign out on production domain"],
                                [
                                    "Database connected",
                                    "Check Vercel logs for successful DB queries, no ETIMEDOUT errors",
                                ],
                                [
                                    "Blob storage",
                                    "Upload a document — check it stores successfully (no MissingBlobTokenError)",
                                ],
                                ["Document Q&A", "Ask a question against an uploaded document"],
                                [
                                    "Background jobs",
                                    "Upload a document and verify the Inngest pipeline runs in the Inngest dashboard",
                                ],
                            ].map(([check, how]) => (
                                <tr
                                    key={check}
                                    className={darkMode ? "bg-gray-800/40" : "bg-white"}
                                >
                                    <td
                                        className={`px-4 py-3 font-medium ${darkMode ? "text-gray-300" : "text-gray-700"}`}
                                    >
                                        {check}
                                    </td>
                                    <td
                                        className={`px-4 py-3 ${darkMode ? "text-gray-400" : "text-gray-600"}`}
                                    >
                                        {how}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </Section>

            {/* ── Callouts ── */}
            <div className="mb-16 space-y-4">
                <Callout icon={<ShieldAlert className="h-5 w-5" />} variant="warning">
                    <strong>Security:</strong> Never commit secrets to git. Keep all API keys in
                    Vercel project settings only.
                </Callout>

                <Callout icon={<Globe className="h-5 w-5" />}>
                    Every push to{" "}
                    <code
                        className={`${darkMode ? "bg-gray-800" : "bg-purple-100"} rounded px-1.5 py-0.5 text-xs`}
                    >
                        main
                    </code>{" "}
                    triggers a new production deploy automatically.
                </Callout>
            </div>
        </>
    );
};
