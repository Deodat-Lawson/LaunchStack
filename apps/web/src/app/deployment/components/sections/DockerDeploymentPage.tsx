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
  
}

const StepCard: React.FC<StepCardProps> = ({ icon, title, children }) => {
  const darkMode = false;
  return (
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
};

interface CalloutProps {
  icon: React.ReactNode;
  
  variant?: 'info' | 'warning';
  children: React.ReactNode;
}

const Callout: React.FC<CalloutProps> = ({ icon, variant = 'info', children }) => {
  const darkMode = false;
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

const Divider: React.FC = () => (
  <hr className="my-12 border-t border-gray-200" />
);

/* ── Page ── */

export const DockerDeploymentPage: React.FC<DeploymentProps> = ({
  copyToClipboard,
  copiedCode,
}) => {
  const darkMode = false;
  const fullStackCmd = 'docker compose --env-file .env up --build';
  const detachedCmd = 'docker compose --env-file .env up -d';
  const appOnlyCmd = `docker build -f apps/web/Dockerfile -t pdr-ai-app .
docker run --rm -p 3000:3000 \\
  -e DATABASE_URL="$DATABASE_URL" \\
  -e CLERK_SECRET_KEY="$CLERK_SECRET_KEY" \\
  -e NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY" \\
  -e CHAT_BASE_URL="$CHAT_BASE_URL" \\
  -e CHAT_API_KEY="$CHAT_API_KEY" \\
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
          Self-host Launchstack with Docker Compose. The stack includes PostgreSQL with pgvector, automatic schema migrations, S3-compatible object storage, the Next.js app, the background worker, and the compute services.
        </p>
      </motion.div>

      <Divider />

      {/* ── What&apos;s in the stack ── */}
      <Section title="What runs" subtitle="The default profile starts everything Local mode requires.">
        <div className="space-y-3">
          <StepCard icon={<Database className="w-5 h-5" />} title="db">
            PostgreSQL 16 with pgvector pre-installed (host port 5433). Data is persisted in a named volume.
          </StepCard>
          <StepCard icon={<RefreshCw className="w-5 h-5" />} title="migrate">
            Runs <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>pnpm db:migrate</code> once after the database is healthy, then exits.
          </StepCard>
          <StepCard icon={<Database className="w-5 h-5" />} title="seaweedfs">
            S3-compatible object storage for uploaded files — no Vercel Blob token needed when self-hosting.
          </StepCard>
          <StepCard icon={<Server className="w-5 h-5" />} title="transcription / document-editor / document-converter">
            The compute services: Whisper transcription and yt-dlp download (port 8000), Adeu DOCX redlining (port 8003), and OCR routing, vision classification, and docling-backed parsing (port 8002). Each authenticates with a fail-closed API key.
          </StepCard>
          <StepCard icon={<RefreshCw className="w-5 h-5" />} title="worker">
            The sole durable workflow coordinator (port 8020): consumes the transactional outbox, runs the ingestion pipeline, and hosts the Inngest serve endpoint at <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>/api/inngest</code>. Health at <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>/healthz</code>.
          </StepCard>
          <StepCard icon={<Server className="w-5 h-5" />} title="app">
            Production Next.js server on port 3000 — command acceptance and reads. Durable work happens in the worker.
          </StepCard>
          <StepCard icon={<Server className="w-5 h-5" />} title="inngest-dev">
            Inngest dev server (dashboard at port 8288), polling the worker&apos;s <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>/api/inngest</code> endpoint — not the app.
          </StepCard>
        </div>
      </Section>

      {/* ── Full stack steps ── */}
      <Section title="Full stack setup" subtitle="Run the entire stack with one command.">
        <div className="space-y-6">
          <Step
            number={1}
            title="Create .env"
            description="Set the required variables at the project root. Compose wires DATABASE_URL, object storage (SeaweedFS), and the compute-service URLs itself."
            code={`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>
CLERK_SECRET_KEY=<your-clerk-secret-key>
CHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
CHAT_API_KEY=<your-google-ai-key>
# Models and routes live in apps/web/config/chat-models.yaml,
# which Compose mounts read-only into the container.

# Optional — defaults shown; override in production
# POSTGRES_PASSWORD=password
# INNGEST_EVENT_KEY=dev-placeholder`}
            onCopy={() => copyToClipboard(`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=<your-clerk-publishable-key>\nCLERK_SECRET_KEY=<your-clerk-secret-key>\nCHAT_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai\nCHAT_API_KEY=<your-google-ai-key>`, 'docker-1')}
            copied={copiedCode === 'docker-1'}

          />

          <Step
            number={2}
            title="Build and start"
            code={fullStackCmd}
            onCopy={() => copyToClipboard(fullStackCmd, 'docker-2')}
            copied={copiedCode === 'docker-2'}

          />

          <Step
            number={3}
            title="Run in background (optional)"
            code={detachedCmd}
            onCopy={() => copyToClipboard(detachedCmd, 'docker-3')}
            copied={copiedCode === 'docker-3'}

          />

          <Step
            number={4}
            title="Verify"
            description="Check that the app, the worker, and the Inngest dashboard are healthy."
            code={`docker compose ps
curl http://localhost:3000
curl http://localhost:8020/healthz
open http://localhost:8288`}
            onCopy={() => copyToClipboard('docker compose ps\ncurl http://localhost:3000\ncurl http://localhost:8020/healthz\nopen http://localhost:8288', 'docker-4')}
            copied={copiedCode === 'docker-4'}

          />
        </div>
      </Section>

      <Divider />

      {/* ── App-only alternative ── */}
      <Section
        title="App container only"
        subtitle="Use this when your PostgreSQL is managed externally (Neon, Supabase, RDS, etc.). Note: the app alone accepts uploads but does not process them — a worker process must run alongside it (see ADR-003)."

      >
        <Step
          number={1}
          title="Build and run"
          code={appOnlyCmd}
          onCopy={() => copyToClipboard(appOnlyCmd, 'docker-5')}
          copied={copiedCode === 'docker-5'}

        />
      </Section>

      <Divider />

      {/* ── Compose profiles ── */}
      <Section title="Compose profiles">
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
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>db, migrate, seaweedfs, transcription, document-editor, document-converter, worker, app, inngest-dev</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Everything Local mode requires</td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded text-xs`}>--profile ocr</code>
                </td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>+ docling-serve</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>PDF/Office parsing engine (~800MB RAM). Without it, /convert returns a typed 503 and text-file ingestion still works</td>
              </tr>
              <tr className={darkMode ? 'bg-gray-800/40' : 'bg-white'}>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded text-xs`}>--profile backfill</code>
                </td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>backfill (on demand)</td>
                <td className={`px-4 py-3 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>Data backfills via <code className="text-xs">docker compose --profile backfill run --rm backfill --list</code></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Callouts ── */}
      <div className="space-y-4 mb-16">
        <Callout icon={<CheckCircle2 className="w-5 h-5" />}>
          <strong>Health check:</strong> Run <code className={`${darkMode ? 'bg-gray-800' : 'bg-purple-100'} px-1.5 py-0.5 rounded text-xs`}>docker compose ps</code> to confirm <em>migrate</em> exited successfully and <em>db</em>, <em>app</em>, <em>worker</em>, and the compute services are healthy.
        </Callout>

        <Callout icon={<ShieldAlert className="w-5 h-5" />} variant="warning">
          <strong>If migration fails:</strong> Rebuild without cache and restart:{' '}
          <code className={`${darkMode ? 'bg-gray-800' : 'bg-yellow-100'} px-1.5 py-0.5 rounded text-xs`}>
            docker compose --env-file .env build --no-cache migrate && docker compose --env-file .env up
          </code>
        </Callout>
      </div>
    </>
  );
};
