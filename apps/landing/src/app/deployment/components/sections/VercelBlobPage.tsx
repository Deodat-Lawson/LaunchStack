"use client";

import React from "react";
import { motion } from "motion/react";
import { Database, Check, ExternalLink } from "lucide-react";
import type { DeploymentProps } from "../../types";
import { Section, CodeBlock, WarningBox, InfoBox } from "../ui";

export const VercelBlobPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
    const darkMode = false;
    return (
        <>
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="mb-12"
            >
                <div
                    className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? "bg-purple-900/50 text-purple-300" : "bg-purple-100 text-purple-700"} mb-6 rounded-full text-sm font-medium`}
                >
                    <Database className="h-4 w-4" />
                    Required Integration
                </div>

                <h1 className="mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-4xl font-bold text-transparent">
                    Vercel Blob Storage
                </h1>
                <p className={`text-lg ${darkMode ? "text-gray-300" : "text-gray-600"} mb-6`}>
                    Cloud file storage for document uploads, powered by Vercel&apos;s edge-optimized
                    blob store.
                </p>
            </motion.div>

            <Section title="What is Vercel Blob?">
                <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-4`}>
                    Vercel Blob is a serverless file storage service that integrates natively with
                    Vercel deployments. Launchstack uses it to store uploaded documents with:
                </p>
                <ul className={`space-y-2 ${darkMode ? "text-gray-300" : "text-gray-600"}`}>
                    <li className="flex items-start gap-2">
                        <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                        <span>Edge-optimized file delivery with global CDN</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                        <span>Automatic public or private access mode detection</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                        <span>Bearer-token authentication for private blobs</span>
                    </li>
                    <li className="flex items-start gap-2">
                        <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                        <span>No additional infrastructure — works out of the box on Vercel</span>
                    </li>
                </ul>
            </Section>

            <Section title="Why is Vercel Blob required?">
                <WarningBox
                    title="No fallback storage"
                    description="Launchstack uses Vercel Blob as the primary document storage backend. If BLOB_READ_WRITE_TOKEN is not configured, document uploads will fail with a MissingBlobTokenError. There is currently no database-only fallback for file storage."
                />
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                    <div
                        className={`rounded-xl p-4 ${darkMode ? "border border-purple-500/30 bg-purple-900/30" : "border border-purple-200 bg-purple-50"}`}
                    >
                        <h4
                            className={`mb-2 font-semibold ${darkMode ? "text-purple-300" : "text-purple-700"}`}
                        >
                            Vercel Blob (Required)
                        </h4>
                        <ul
                            className={`space-y-1 text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}
                        >
                            <li>• Used for all document uploads</li>
                            <li>• Edge-optimized delivery</li>
                            <li>• Public &amp; private store support</li>
                            <li>• Works on Vercel and non-Vercel hosts</li>
                        </ul>
                    </div>
                    <div
                        className={`rounded-xl p-4 ${darkMode ? "border border-slate-600/30 bg-slate-800/50" : "border border-slate-200 bg-slate-50"}`}
                    >
                        <h4
                            className={`mb-2 font-semibold ${darkMode ? "text-slate-300" : "text-slate-700"}`}
                        >
                            UploadThing (Optional alternative)
                        </h4>
                        <ul
                            className={`space-y-1 text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}
                        >
                            <li>• Optional cloud upload path</li>
                            <li>• CDN-backed delivery</li>
                            <li>• Vercel Blob is still needed for retrieval</li>
                            <li>• See the UploadThing page for setup</li>
                        </ul>
                    </div>
                </div>
            </Section>

            <Section title="Setup Instructions">
                <div className="space-y-6">
                    <div>
                        <h3
                            className={`mb-3 text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Step 1: Create a Blob Store in Vercel
                        </h3>
                        <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                            Open your project in the{" "}
                            <a
                                href="https://vercel.com/dashboard"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-purple-600 hover:underline"
                            >
                                Vercel Dashboard <ExternalLink className="h-4 w-4" />
                            </a>
                            , then navigate to <strong>Storage</strong> →{" "}
                            <strong>Create Database</strong> → <strong>Blob</strong>.
                        </p>
                        <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                            Choose a name for your store (e.g.{" "}
                            <code
                                className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-purple-300" : "bg-gray-100 text-purple-700"}`}
                            >
                                launchstack-documents
                            </code>
                            ) and select a region close to your deployment.
                        </p>
                    </div>

                    <div>
                        <h3
                            className={`mb-3 text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Step 2: Connect the Store to Your Project
                        </h3>
                        <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                            In the blob store settings, click <strong>Connect Project</strong> and
                            select your Launchstack project. Vercel will automatically inject the{" "}
                            <code
                                className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-purple-300" : "bg-gray-100 text-purple-700"}`}
                            >
                                BLOB_READ_WRITE_TOKEN
                            </code>{" "}
                            environment variable into your deployment.
                        </p>
                    </div>

                    <div>
                        <h3
                            className={`mb-3 text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Step 3: Add to Local Environment (for development)
                        </h3>
                        <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                            Copy the token from your blob store&apos;s settings page and add it to
                            your local{" "}
                            <code
                                className={`rounded px-1.5 py-0.5 text-sm ${darkMode ? "bg-gray-800 text-purple-300" : "bg-gray-100 text-purple-700"}`}
                            >
                                .env
                            </code>{" "}
                            file:
                        </p>
                        <CodeBlock
                            code={`BLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>`}
                            onCopy={() =>
                                copyToClipboard(
                                    "BLOB_READ_WRITE_TOKEN=<your-vercel-blob-token>",
                                    "blob-env"
                                )
                            }
                            copied={copiedCode === "blob-env"}
                        />
                        <p
                            className={`${darkMode ? "text-gray-400" : "text-gray-500"} mt-2 text-sm`}
                        >
                            You can also pull your Vercel env variables locally with:
                        </p>
                        <CodeBlock
                            code={`vercel env pull .env.local`}
                            onCopy={() =>
                                copyToClipboard("vercel env pull .env.local", "blob-env-pull")
                            }
                            copied={copiedCode === "blob-env-pull"}
                        />
                    </div>

                    <div>
                        <h3
                            className={`mb-3 text-lg font-semibold ${darkMode ? "text-white" : "text-gray-900"}`}
                        >
                            Step 4: Deploy
                        </h3>
                        <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                            Once connected, push your code or trigger a redeploy. Launchstack will
                            automatically detect the token and use Vercel Blob for document storage.
                            No code changes are needed.
                        </p>
                    </div>

                    <WarningBox
                        title="Token Required"
                        description="Without BLOB_READ_WRITE_TOKEN, document uploads will fail. This is a required environment variable — there is no database-only fallback for file storage."
                    />
                </div>
            </Section>

            <Section title="Public vs Private Stores">
                <InfoBox title="Automatic Access Detection" icon={<Database className="h-5 w-5" />}>
                    <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-3`}>
                        Launchstack automatically detects whether your blob store is configured as
                        public or private. It first attempts a public upload — if your store only
                        allows private access, it retries with private mode and caches the result
                        for subsequent uploads.
                    </p>
                    <ul
                        className={`space-y-1 text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}
                    >
                        <li>
                            <strong>Public stores</strong> — files are served directly via a CDN
                            URL. Simpler, faster delivery.
                        </li>
                        <li>
                            <strong>Private stores</strong> — files require a Bearer token to
                            access. Launchstack handles this automatically when fetching documents.
                        </li>
                    </ul>
                </InfoBox>
            </Section>

            <Section title="How It Works">
                <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-4`}>
                    When a document is uploaded, Launchstack:
                </p>
                <div className="space-y-3">
                    {[
                        {
                            step: "1",
                            text: "Sanitizes the filename and generates a unique storage key",
                        },
                        {
                            step: "2",
                            text: "Uploads the file buffer to Vercel Blob with the detected access mode",
                        },
                        {
                            step: "3",
                            text: "Stores the blob URL and metadata in the database for retrieval",
                        },
                        {
                            step: "4",
                            text: "For private blobs, injects the Bearer token when fetching the document later",
                        },
                    ].map(s => (
                        <div
                            key={s.step}
                            className={`flex items-start gap-3 rounded-lg p-3 ${darkMode ? "bg-gray-800/50" : "bg-gray-50"}`}
                        >
                            <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
                                {s.step}
                            </span>
                            <p
                                className={`text-sm ${darkMode ? "text-gray-300" : "text-gray-600"}`}
                            >
                                {s.text}
                            </p>
                        </div>
                    ))}
                </div>
            </Section>

            <Section title="Vercel CLI Reference">
                <p className={`${darkMode ? "text-gray-300" : "text-gray-600"} mb-4`}>
                    Useful Vercel CLI commands for managing your blob store:
                </p>
                <div className="space-y-3">
                    <div>
                        <p
                            className={`mb-1 text-sm font-medium ${darkMode ? "text-gray-200" : "text-gray-800"}`}
                        >
                            Pull env variables locally
                        </p>
                        <CodeBlock
                            code="vercel env pull .env.local"
                            onCopy={() => copyToClipboard("vercel env pull .env.local", "cli-pull")}
                            copied={copiedCode === "cli-pull"}
                        />
                    </div>
                    <div>
                        <p
                            className={`mb-1 text-sm font-medium ${darkMode ? "text-gray-200" : "text-gray-800"}`}
                        >
                            List linked storage
                        </p>
                        <CodeBlock
                            code="vercel storage ls"
                            onCopy={() => copyToClipboard("vercel storage ls", "cli-ls")}
                            copied={copiedCode === "cli-ls"}
                        />
                    </div>
                </div>
            </Section>
        </>
    );
};
