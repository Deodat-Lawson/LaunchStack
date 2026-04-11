'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  Server,
  Database,
  RefreshCw,
  CheckCircle2,
  ShieldAlert,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step } from '../ui';

/* ── Inline components (shared design language with MainDeployment) ── */

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

export const DockerDeploymentPage: React.FC<DeploymentProps> = ({
  darkMode,
  copyToClipboard,
  copiedCode,
}) => {
  const fullStackCmd = 'docker compose --env-file .env --profile dev up --build';
  const detachedCmd = 'docker compose --env-file .env --profile dev up -d';
  const appOnlyCmd = `docker build -t pdr-ai-app .
docker run --rm -p 3000:3000 \\
  -e DATABASE_URL="$DATABASE_URL" \\
  -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \\
  -e NEXT_PUBLIC_SITE_URL="$NEXT_PUBLIC_SITE_URL" \\
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \\
  -e BLOB_READ_WRITE_TOKEN="$BLOB_READ_WRITE_TOKEN" \\
  -e INNGEST_EVENT_KEY="$INNGEST_EVENT_KEY" \\
  pdr-ai-app`;

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
          Docker Deployment
        </h1>
        <p className={`text-xl leading-relaxed max-w-2xl ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Self-host Launchstack with Docker Compose. The stack includes PostgreSQL with pgvector, automatic schema migrations, and the Next.js runtime.
        </p>
      </motion.div>

      <Divider darkMode={darkMode} />

      {/* ── What&apos;s in the stack ── */}
      <Section title="What runs" subtitle="Docker Compose starts three coordinated services." darkMode={darkMode}>
        <div className="space-y-3">
          <StepCard icon={<Database className="w-5 h-5" />} title="db" darkMode={darkMode}>
            PostgreSQL 16 with pgvector pre-installed. Data is persisted in a named volume.
          </StepCard>
          <StepCard icon={<RefreshCw className="w-5 h-5" />} title="migrate" darkMode={darkMode}>
            Runs <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>pnpm db:push</code> once after the database is healthy, then exits.
          </StepCard>
          <StepCard icon={<Server className="w-5 h-5" />} title="app" darkMode={darkMode}>
            Production Next.js server on port 3000. Connects to the same Compose network as the database.
          </StepCard>
        </div>
      </Section>

      {/* ── Full stack steps ── */}
      <Section title="Full stack setup" subtitle="Run the entire stack with one command." darkMode={darkMode}>
        <div className="space-y-6">
          <Step
            number={1}
            title="Create .env"
            description="Set the required variables at the project root."
            code={`DATABASE_URL="postgresql://postgres:password@db:5432/pdr_ai_v2"
BETTER_AUTH_SECRET=your_generated_secret_here
NEXT_PUBLIC_SITE_URL=http://localhost:3000
OPENAI_API_KEY=sk-proj-xxx

# Vercel Blob — required for document uploads
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx

# Inngest — use a placeholder for local dev
INNGEST_EVENT_KEY=dev-placeholder`}
            onCopy={() => copyToClipboard(`DATABASE_URL="postgresql://postgres:password@db:5432/pdr_ai_v2"\nBETTER_AUTH_SECRET=your_generated_secret_here\nNEXT_PUBLIC_SITE_URL=http://localhost:3000\nOPENAI_API_KEY=sk-proj-xxx\n\nBLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx\n\nINNGEST_EVENT_KEY=dev-placeholder`, 'docker-1')}
            copied={copiedCode === 'docker-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Build and start"
            code={fullStackCmd}
            onCopy={() => copyToClipboard(fullStackCmd, 'docker-2')}
            copied={copiedCode === 'docker-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Run in background (optional)"
            code={detachedCmd}
            onCopy={() => copyToClipboard(detachedCmd, 'docker-3')}
            copied={copiedCode === 'docker-3'}
            darkMode={darkMode}
          />

          <Step
            number={4}
            title="Verify"
            description="Check that the app and services are healthy."
            code={`docker compose ps
curl http://localhost:3000`}
            onCopy={() => copyToClipboard('docker compose ps\ncurl http://localhost:3000', 'docker-4')}
            copied={copiedCode === 'docker-4'}
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── App-only alternative ── */}
      <Section
        title="App container only"
        subtitle="Use this when your PostgreSQL is managed externally (Neon, Supabase, RDS, etc.)."
        darkMode={darkMode}
      >
        <Step
          number={1}
          title="Build and run"
          code={appOnlyCmd}
          onCopy={() => copyToClipboard(appOnlyCmd, 'docker-5')}
          copied={copiedCode === 'docker-5'}
          darkMode={darkMode}
        />
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Compose profiles ── */}
      <Section title="Compose profiles" darkMode={darkMode}>
        <div className={`overflow-hidden rounded-xl border ${darkMode ? 'border-gray-700/60' : 'border-gray-200'}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className={darkMode ? 'bg-gray-800/80' : 'bg-gray-50'}>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Profile</th>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Services</th>
                <th className={`text-left px-4 py-3 font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>Use case</th>
              </tr>
            </thead>
            <tbody className={`divide-y ${darkMode ? 'divide-gray-700/60' : 'divide-gray-200'}`}>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded text-xs`}>default</code>
                </td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>db + migrate + app</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Production-like</td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded text-xs`}>--profile dev</code>
                </td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>+ Inngest dev server</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Local development with background jobs</td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded text-xs`}>--profile minimal</code>
                </td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>db only</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Run Next.js locally with <code className="text-xs">pnpm dev</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Callouts ── */}
      <div className="space-y-4 mb-16">
        <Callout icon={<CheckCircle2 className="w-5 h-5" />} darkMode={darkMode}>
          <strong>Health check:</strong> Run <code className={`${darkMode ? 'bg-gray-800' : 'bg-purple-100'} px-1.5 py-0.5 rounded text-xs`}>docker compose ps</code> to confirm <em>db</em> is running, <em>migrate</em> exited successfully, and <em>app</em> is healthy.
        </Callout>

        <Callout icon={<ShieldAlert className="w-5 h-5" />} darkMode={darkMode} variant="warning">
          <strong>If migration fails:</strong> Rebuild without cache and restart:{' '}
          <code className={`${darkMode ? 'bg-gray-800' : 'bg-yellow-100'} px-1.5 py-0.5 rounded text-xs`}>
            docker compose --env-file .env build --no-cache migrate && docker compose --env-file .env up
          </code>
        </Callout>
      </div>
    </>
  );
};
