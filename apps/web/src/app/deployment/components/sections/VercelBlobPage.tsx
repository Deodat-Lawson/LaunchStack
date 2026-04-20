'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Database, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, WarningBox, InfoBox } from '../ui';

export const VercelBlobPage: React.FC<DeploymentProps> = ({
  darkMode,
  copyToClipboard,
  copiedCode,
}) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-purple-900/50 text-purple-300' : 'bg-purple-100 text-purple-700'} rounded-full font-medium mb-6 text-sm`}>
          <Database className="w-4 h-4" />
          Required Integration
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Vercel Blob Storage
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Cloud file storage for document uploads, powered by Vercel&apos;s edge-optimized blob store.
        </p>
      </motion.div>

      <Section title="What is Vercel Blob?" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          Vercel Blob is a serverless file storage service that integrates natively with Vercel deployments. Launchstack uses it to store uploaded documents with:
        </p>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Edge-optimized file delivery with global CDN</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Automatic public or private access mode detection</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Bearer-token authentication for private blobs</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>No additional infrastructure — works out of the box on Vercel</span>
          </li>
        </ul>
      </Section>

      <Section title="Why is Vercel Blob required?" darkMode={darkMode}>
        <WarningBox
          title="No fallback storage"
          description="Launchstack uses Vercel Blob as the primary document storage backend. If BLOB_READ_WRITE_TOKEN is not configured, document uploads will fail with a MissingBlobTokenError. There is currently no database-only fallback for file storage."
          darkMode={darkMode}
        />
        <div className="mt-6 grid md:grid-cols-2 gap-4">
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-purple-900/30 border border-purple-500/30' : 'bg-purple-50 border border-purple-200'}`}>
            <h4 className={`font-semibold mb-2 ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>
              Vercel Blob (Required)
            </h4>
            <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <li>• Used for all document uploads</li>
              <li>• Edge-optimized delivery</li>
              <li>• Public &amp; private store support</li>
              <li>• Works on Vercel and non-Vercel hosts</li>
            </ul>
          </div>
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-slate-800/50 border border-slate-600/30' : 'bg-slate-50 border border-slate-200'}`}>
            <h4 className={`font-semibold mb-2 ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              UploadThing (Optional alternative)
            </h4>
            <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <li>• Optional cloud upload path</li>
              <li>• CDN-backed delivery</li>
              <li>• Vercel Blob is still needed for retrieval</li>
              <li>• See the UploadThing page for setup</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create a Blob Store in Vercel
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Open your project in the{' '}
              <a href="https://vercel.com/dashboard" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                Vercel Dashboard <ExternalLink className="w-4 h-4" />
              </a>
              , then navigate to <strong>Storage</strong> → <strong>Create Database</strong> → <strong>Blob</strong>.
            </p>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Choose a name for your store (e.g. <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-purple-300' : 'bg-gray-100 text-purple-700'}`}>pdr-ai-documents</code>)
              and select a region close to your deployment.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Connect the Store to Your Project
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              In the blob store settings, click <strong>Connect Project</strong> and select your Launchstack project.
              Vercel will automatically inject the <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-purple-300' : 'bg-gray-100 text-purple-700'}`}>BLOB_READ_WRITE_TOKEN</code> environment variable into your deployment.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Add to Local Environment (for development)
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Copy the token from your blob store&apos;s settings page and add it to your local <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-purple-300' : 'bg-gray-100 text-purple-700'}`}>.env</code> file:
            </p>
            <CodeBlock
              code={`BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx`}
              onCopy={() => copyToClipboard('BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx', 'blob-env')}
              copied={copiedCode === 'blob-env'}
              darkMode={darkMode}
            />
            <p className={`${darkMode ? 'text-gray-400' : 'text-gray-500'} text-sm mt-2`}>
              You can also pull your Vercel env variables locally with:
            </p>
            <CodeBlock
              code={`vercel env pull .env.local`}
              onCopy={() => copyToClipboard('vercel env pull .env.local', 'blob-env-pull')}
              copied={copiedCode === 'blob-env-pull'}
              darkMode={darkMode}
            />
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 4: Deploy
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Once connected, push your code or trigger a redeploy. Launchstack will automatically detect the token
              and use Vercel Blob for document storage. No code changes are needed.
            </p>
          </div>

          <WarningBox
            title="Token Required"
            description="Without BLOB_READ_WRITE_TOKEN, document uploads will fail. This is a required environment variable — there is no database-only fallback for file storage."
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Section title="Public vs Private Stores" darkMode={darkMode}>
        <InfoBox title="Automatic Access Detection" icon={<Database className="w-5 h-5" />} darkMode={darkMode}>
          <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
            Launchstack automatically detects whether your blob store is configured as public or private.
            It first attempts a public upload — if your store only allows private access, it retries with private mode
            and caches the result for subsequent uploads.
          </p>
          <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <li><strong>Public stores</strong> — files are served directly via a CDN URL. Simpler, faster delivery.</li>
            <li><strong>Private stores</strong> — files require a Bearer token to access. Launchstack handles this automatically when fetching documents.</li>
          </ul>
        </InfoBox>
      </Section>

      <Section title="How It Works" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          When a document is uploaded, Launchstack:
        </p>
        <div className="space-y-3">
          {[
            { step: '1', text: 'Sanitizes the filename and generates a unique storage key' },
            { step: '2', text: 'Uploads the file buffer to Vercel Blob with the detected access mode' },
            { step: '3', text: 'Stores the blob URL and metadata in the database for retrieval' },
            { step: '4', text: 'For private blobs, injects the Bearer token when fetching the document later' },
          ].map((s) => (
            <div key={s.step} className={`flex items-start gap-3 p-3 rounded-lg ${darkMode ? 'bg-gray-800/50' : 'bg-gray-50'}`}>
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {s.step}
              </span>
              <p className={`text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>{s.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Vercel CLI Reference" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          Useful Vercel CLI commands for managing your blob store:
        </p>
        <div className="space-y-3">
          <div>
            <p className={`text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>Pull env variables locally</p>
            <CodeBlock
              code="vercel env pull .env.local"
              onCopy={() => copyToClipboard('vercel env pull .env.local', 'cli-pull')}
              copied={copiedCode === 'cli-pull'}
              darkMode={darkMode}
            />
          </div>
          <div>
            <p className={`text-sm font-medium mb-1 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>List linked storage</p>
            <CodeBlock
              code="vercel storage ls"
              onCopy={() => copyToClipboard('vercel storage ls', 'cli-ls')}
              copied={copiedCode === 'cli-ls'}
              darkMode={darkMode}
            />
          </div>
        </div>
      </Section>
    </>
  );
};
