'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  Rocket,
  Database,
  Settings,
  Globe,
  ShieldAlert,
  ExternalLink,
  Play,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step } from '../ui';

/* ── Inline components (shared design language) ── */

interface StepCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  darkMode: boolean;
}

const StepCard: React.FC<StepCardProps> = ({ icon, title, children, darkMode }) => (
  <div
    className={`flex items-start gap-4 p-5 rounded-xl border transition-all duration-200 ${
      darkMode
        ? 'bg-gray-800/60 border-gray-700/60 hover:border-purple-500/40'
        : 'bg-white border-gray-200 hover:border-purple-300 hover:shadow-md'
    }`}
  >
    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center text-white shadow-lg shadow-purple-500/20">
      {icon}
    </div>
    <div className="flex-1 min-w-0">
      <h3 className={`font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
      <div className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{children}</div>
    </div>
  </div>
);

interface CalloutProps {
  icon: React.ReactNode;
  darkMode: boolean;
  variant?: 'info' | 'warning';
  children: React.ReactNode;
}

const Callout: React.FC<CalloutProps> = ({ icon, darkMode, variant = 'info', children }) => {
  const colors = {
    info: darkMode
      ? 'bg-purple-900/20 border-purple-800/50 text-purple-300'
      : 'bg-purple-50 border-purple-200 text-purple-800',
    warning: darkMode
      ? 'bg-yellow-900/20 border-yellow-800/50 text-yellow-300'
      : 'bg-yellow-50 border-yellow-200 text-yellow-800',
  };

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border text-sm leading-relaxed ${colors[variant]}`}>
      <div className="flex-shrink-0 mt-0.5">{icon}</div>
      <div>{children}</div>
    </div>
  );
};

const Divider: React.FC<{ darkMode: boolean }> = ({ darkMode }) => (
  <hr className={`my-12 border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'}`} />
);

/* ── Page ── */

export const VercelDeploymentPage: React.FC<DeploymentProps> = ({
  darkMode,
  copyToClipboard,
  copiedCode,
}) => {
  return (
    <>
      {/* ── Hero ── */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Vercel Deployment
        </h1>
        <p className={`text-xl leading-relaxed max-w-2xl ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Deploy Launchstack with managed hosting from Vercel. Connect your GitHub repository, add environment variables, and go live with zero infrastructure to maintain.
        </p>
      </motion.div>

      <Divider darkMode={darkMode} />

      {/* ── How it works ── */}
      <Section title="How it works" subtitle="Vercel handles builds and hosting. You provide the database and API keys." darkMode={darkMode}>
        <div className="space-y-3">
          <StepCard icon={<Rocket className="w-5 h-5" />} title="Fork and import" darkMode={darkMode}>
            First, fork{' '}
            <a href="https://github.com/Deodat-Lawson/pdr_ai_v2/fork" target="_blank" rel="noopener noreferrer" className="text-purple-500 hover:underline inline-flex items-center gap-1">
              Deodat-Lawson/pdr_ai_v2 <ExternalLink className="w-3 h-3" />
            </a>{' '}
            to your own GitHub account. Then create a new Vercel project at{' '}
            <a href="https://vercel.com/new" target="_blank" rel="noopener noreferrer" className="text-purple-500 hover:underline inline-flex items-center gap-1">
              vercel.com/new <ExternalLink className="w-3 h-3" />
            </a>{' '}
            and import your fork. Vercel auto-detects Next.js and configures builds.
          </StepCard>
          <StepCard icon={<Database className="w-5 h-5" />} title="Neon serverless database" darkMode={darkMode}>
            Use{' '}
            <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" className="text-purple-500 hover:underline inline-flex items-center gap-1">
              Neon <ExternalLink className="w-3 h-3" />
            </a>{' '}
            for managed PostgreSQL with pgvector. Paste the connection string as <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>DATABASE_URL</code>.
          </StepCard>
          <StepCard icon={<Settings className="w-5 h-5" />} title="Environment variables" darkMode={darkMode}>
            Set all required keys in <strong>Project Settings → Environment Variables</strong> for Production (and Preview if needed).
          </StepCard>
        </div>
      </Section>

      {/* ── Step-by-step ── */}
      <Section title="Step-by-step setup" darkMode={darkMode}>
        <div className="space-y-6">
          <Step
            number={1}
            title="Fork the repository"
            description="Go to the Launchstack repo and click Fork to create a copy under your GitHub account."
            onCopy={() => copyToClipboard('https://github.com/Deodat-Lawson/pdr_ai_v2/fork', 'v-1a')}
            copied={copiedCode === 'v-1a'}
            darkMode={darkMode}
          >
            <a
              href="https://github.com/Deodat-Lawson/pdr_ai_v2/fork"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-purple-500 hover:text-purple-400 hover:underline font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              github.com/Deodat-Lawson/pdr_ai_v2/fork
            </a>
          </Step>

          <Step
            number={2}
            title="Create a new Vercel project"
            description="Select your forked repo and keep the Next.js framework defaults."
            onCopy={() => copyToClipboard('https://vercel.com/new', 'v-1b')}
            copied={copiedCode === 'v-1b'}
            darkMode={darkMode}
          >
            <a
              href="https://vercel.com/new"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-purple-500 hover:text-purple-400 hover:underline font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              vercel.com/new
            </a>
          </Step>

          <Step
            number={3}
            title="Add environment variables"
            description="Paste these into Vercel's Environment Variables panel before the first deploy. BLOB_READ_WRITE_TOKEN is auto-injected when you connect a Blob store (see below)."
            code={`DATABASE_URL=postgresql://<neon-connection-string>
BETTER_AUTH_SECRET=<your-random-secret>
NEXT_PUBLIC_SITE_URL=https://your-app-domain.com
OPENAI_API_KEY=sk-proj-xxx
INNGEST_EVENT_KEY=evt_xxx
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx`}
            onCopy={() => copyToClipboard(`DATABASE_URL=postgresql://<neon-connection-string>\nBETTER_AUTH_SECRET=<your-random-secret>\nNEXT_PUBLIC_SITE_URL=https://your-app-domain.com\nOPENAI_API_KEY=sk-proj-xxx\nINNGEST_EVENT_KEY=evt_xxx\nBLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxx`, 'v-2')}
            copied={copiedCode === 'v-2'}
            darkMode={darkMode}
          />

          <Step
            number={4}
            title="Create a Vercel Blob store"
            description="Go to your Vercel project → Storage → Create Database → Blob. Connect it to your project — this auto-injects BLOB_READ_WRITE_TOKEN. Document uploads will fail without this."
            onCopy={() => copyToClipboard('https://vercel.com/dashboard', 'v-blob')}
            copied={copiedCode === 'v-blob'}
            darkMode={darkMode}
          >
            <a
              href="https://vercel.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-purple-500 hover:text-purple-400 hover:underline font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Vercel Dashboard → Storage
            </a>
          </Step>

          <Step
            number={5}
            title="Deploy"
            description="Click Deploy in your Vercel project dashboard. Vercel builds and publishes the app automatically."
            onCopy={() => copyToClipboard('https://vercel.com/dashboard', 'v-3')}
            copied={copiedCode === 'v-3'}
            darkMode={darkMode}
          >
            <a
              href="https://vercel.com/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-purple-500 hover:text-purple-400 hover:underline font-medium"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              vercel.com/dashboard
            </a>
          </Step>

          <Step
            number={6}
            title="Validate"
            description="Open your production domain and confirm these routes work:"
            onCopy={() => copyToClipboard('https://your-app.vercel.app\nhttps://your-app.vercel.app/sign-in\nhttps://your-app.vercel.app/dashboard', 'v-4')}
            copied={copiedCode === 'v-4'}
            darkMode={darkMode}
          >
            <div className="space-y-1">
              <div><code className="text-sm text-purple-500">your-app.vercel.app</code></div>
              <div><code className="text-sm text-purple-500">your-app.vercel.app/sign-in</code></div>
              <div><code className="text-sm text-purple-500">your-app.vercel.app/dashboard</code></div>
            </div>
          </Step>
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Post-deploy checklist ── */}
      <Section title="Post-deploy checklist" darkMode={darkMode}>
        <div className={`overflow-hidden rounded-xl border ${darkMode ? 'border-gray-700/60' : 'border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={darkMode ? 'bg-gray-800/80' : 'bg-gray-50'}>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Check</th>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>How to verify</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${darkMode ? 'divide-gray-700/60' : 'divide-gray-200'}`}>
              {[
                ['Auth works', 'Sign in and sign out on production domain'],
                ['Database connected', 'Check Vercel logs for successful DB queries, no ETIMEDOUT errors'],
                ['Blob storage', 'Upload a document — check it stores successfully (no MissingBlobTokenError)'],
                ['Document Q&A', 'Ask a question against an uploaded document'],
                ['Background jobs', 'Upload a document and verify the Inngest pipeline runs in the Inngest dashboard'],
              ].map(([check, how]) => (
                <tr key={check} className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                  <td className={`px-4 py-3 font-medium ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{check}</td>
                  <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Video walkthrough ── */}
      <Section
        title="Video walkthrough"
        subtitle="Drop a recording to show the full Vercel setup flow on a loop."
        darkMode={darkMode}
      >
        <div
          className={`rounded-xl border overflow-hidden ${
            darkMode ? 'border-gray-700/60 bg-gray-800/40' : 'border-gray-200 bg-white'
          }`}
        >
          <video
            src="/deployment-demos/vercel-setup.mov"
            controls
            loop
            muted
            playsInline
            className="w-full aspect-video bg-black"
          />
          <div className="p-4">
            <div className="flex items-center gap-2 mb-1">
              <Play className="w-4 h-4 text-purple-500" />
              <h4 className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                Vercel Setup Demo
              </h4>
            </div>
            <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
              <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded`}>
                public/deployment-demos/vercel-setup.mov
              </code>
            </p>
          </div>
        </div>
      </Section>

      {/* ── Callouts ── */}
      <div className="space-y-4 mb-16">
        <Callout icon={<ShieldAlert className="w-5 h-5" />} darkMode={darkMode} variant="warning">
          <strong>Security:</strong> Never commit secrets to git. Keep all API keys in Vercel project settings only.
        </Callout>

        <Callout icon={<Globe className="w-5 h-5" />} darkMode={darkMode}>
          Every push to <code className={`${darkMode ? 'bg-gray-800' : 'bg-purple-100'} px-1.5 py-0.5 rounded text-xs`}>main</code> triggers a new production deploy automatically.
        </Callout>
      </div>
    </>
  );
};
