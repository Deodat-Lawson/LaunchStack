'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  Layers,
  Zap,
  RefreshCw,
  Clock,
  Shield,
  BarChart3,
  CheckCircle2,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, Step, ApiKeyCard, InfoBox, WarningBox } from '../ui';

export const InngestPage: React.FC<DeploymentProps> = ({
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
        className="mb-16"
      >
        <div
          className={`inline-flex items-center gap-2 px-4 py-2 ${
            darkMode
              ? 'bg-emerald-900/50 text-emerald-300'
              : 'bg-emerald-100 text-emerald-700'
          } rounded-full font-medium mb-6 text-sm`}
        >
          <Layers className="w-4 h-4" />
          Required Integration
        </div>

        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
          Inngest Background Jobs
        </h1>

        <p className={`text-xl ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Reliable background processing for document OCR pipelines with automatic retries,
          observability, and step-based execution.
        </p>
      </motion.div>

      {/* Benefits */}
      <Section title="Why Inngest?" darkMode={darkMode}>
        <div className="grid md:grid-cols-2 gap-6">
          <BenefitCard
            icon={<RefreshCw className="w-6 h-6" />}
            title="Automatic Retries"
            description="Failed steps automatically retry with exponential backoff. No lost documents due to transient failures."
            darkMode={darkMode}
          />
          <BenefitCard
            icon={<Layers className="w-6 h-6" />}
            title="Step-Based Execution"
            description="Each pipeline step (Router → OCR → Chunking → Vectorize → Store) runs independently. Failures only retry the failed step."
            darkMode={darkMode}
          />
          <BenefitCard
            icon={<Clock className="w-6 h-6" />}
            title="Long-Running Jobs"
            description="Process large documents without timeout limits. Inngest handles jobs that take minutes or hours."
            darkMode={darkMode}
          />
          <BenefitCard
            icon={<BarChart3 className="w-6 h-6" />}
            title="Observability Dashboard"
            description="Visual timeline of every job, step durations, error logs, and retry history in one dashboard."
            darkMode={darkMode}
          />
          <BenefitCard
            icon={<Shield className="w-6 h-6" />}
            title="Rate Limiting & Concurrency"
            description="Control how many documents process simultaneously. Prevent overwhelming external APIs."
            darkMode={darkMode}
          />
          <BenefitCard
            icon={<Zap className="w-6 h-6" />}
            title="Vercel Integration"
            description="One-click setup with Vercel. Auto-configures keys and endpoints."
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* How the Pipeline Works */}
      <Section title="How the Pipeline Works" darkMode={darkMode}>
        <div
          className={`rounded-xl p-6 ${
            darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
          }`}
        >
          <div className="space-y-4">
            <PipelineStep step="A" title="Router" description="Analyzes PDF to determine: native text extraction or OCR needed? Which provider (Azure, Landing.AI)?" darkMode={darkMode} />
            <PipelineStep step="B" title="Normalize" description="Extracts content using the selected provider. Outputs standardized PageContent[] structure." darkMode={darkMode} />
            <PipelineStep step="C" title="Chunking" description="Splits pages into semantic chunks (500 tokens, 50 overlap). Separates tables from text." darkMode={darkMode} />
            <PipelineStep step="D" title="Vectorize" description="Generates embeddings via OpenAI text-embedding-3-large (1536 dimensions)." darkMode={darkMode} />
            <PipelineStep step="E" title="Storage" description="Persists chunks with vectors to PostgreSQL. Updates document and job status." darkMode={darkMode} />
          </div>
        </div>
      </Section>

      {/* Development Setup */}
      <Section title="Development Setup" darkMode={darkMode}>
        <InfoBox
          title="Inngest starts automatically"
          icon={<Zap className="w-5 h-5" />}
          darkMode={darkMode}
        >
          <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
            Running <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-emerald-300' : 'bg-gray-100 text-emerald-700'}`}>pnpm dev</code> automatically
            starts both Next.js and the Inngest dev server using <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-emerald-300' : 'bg-gray-100 text-emerald-700'}`}>concurrently</code>.
            No additional setup is needed to get background jobs working locally.
          </p>
          <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
            The Inngest dev server dashboard is available at{' '}
            <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-emerald-300' : 'bg-gray-100 text-emerald-700'}`}>http://localhost:8288</code>{' '}
            where you can monitor jobs, view step execution, and inspect logs.
          </p>
        </InfoBox>

        <div className="mt-8 space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Start the dev server (Next.js + Inngest together)
            </h3>
            <CodeBlock
              code="pnpm dev"
              onCopy={() => copyToClipboard('pnpm dev', 'inngest-dev')}
              copied={copiedCode === 'inngest-dev'}
              darkMode={darkMode}
            />
            <p className={`text-sm mt-2 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
              This runs the equivalent of:
            </p>
            <CodeBlock
              code={`concurrently \\
  "next dev --turbo" \\
  "pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest"`}
              onCopy={() => copyToClipboard('concurrently "next dev --turbo" "pnpm dlx inngest-cli@latest dev -u http://localhost:3000/api/inngest"', 'inngest-dev-full')}
              copied={copiedCode === 'inngest-dev-full'}
              darkMode={darkMode}
            />
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              INNGEST_EVENT_KEY in development
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              The Inngest dev server does <strong>not</strong> require a real event key. You can use any placeholder value
              in your <code className={`px-1.5 py-0.5 rounded text-sm ${darkMode ? 'bg-gray-800 text-emerald-300' : 'bg-gray-100 text-emerald-700'}`}>.env</code> file:
            </p>
            <CodeBlock
              code={`# Placeholder — the Inngest dev server accepts any value
INNGEST_EVENT_KEY=dev-placeholder`}
              onCopy={() => copyToClipboard('INNGEST_EVENT_KEY=dev-placeholder', 'inngest-dev-key')}
              copied={copiedCode === 'inngest-dev-key'}
              darkMode={darkMode}
            />
            <WarningBox
              title="Required at startup"
              description="INNGEST_EVENT_KEY must be set to a non-empty value or the app will throw an error on startup. In development, any placeholder string works fine."
              darkMode={darkMode}
            />
          </div>
        </div>
      </Section>

      {/* Production Setup */}
      <Section title="Production Setup" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          In production, Inngest Cloud handles job scheduling, retries, and monitoring.
          You need a real event key and signing key from your Inngest account.
        </p>

        <div className="space-y-6">
          <ApiKeyCard
            title="Option 1: Vercel Integration (Recommended)"
            link="https://vercel.com/integrations/inngest"
            description="One-click setup that auto-configures environment variables"
            steps={[
              'Go to Vercel Dashboard → Integrations',
              'Search for "Inngest" and click Install',
              'Authorize and select your project',
              'Environment variables are automatically added',
              'Redeploy your application',
            ]}
            darkMode={darkMode}
          />

          <ApiKeyCard
            title="Option 2: Manual Configuration"
            link="https://inngest.com"
            description="For non-Vercel deployments or custom setups"
            steps={[
              'Create account at inngest.com',
              'Create a new app in the dashboard',
              'Go to Settings → Event Keys → Create Key',
              'Copy INNGEST_EVENT_KEY to your environment',
              'Go to Settings → Signing Key',
              'Copy INNGEST_SIGNING_KEY to your environment',
            ]}
            darkMode={darkMode}
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
                'inngest-prod-env'
              )
            }
            copied={copiedCode === 'inngest-prod-env'}
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* Architecture Diagram */}
      <Section title="Architecture" darkMode={darkMode}>
        <div className="rounded-xl p-6 font-mono text-sm bg-gray-900 text-gray-300">
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
                             ▼
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
      <Section title="Verify Setup" darkMode={darkMode}>
        <div className="space-y-4">
          <VerificationStep text="Run pnpm dev — both Next.js and Inngest dev server start" darkMode={darkMode} />
          <VerificationStep text="Open http://localhost:8288 — Inngest dashboard shows 'pdr-ai' app" darkMode={darkMode} />
          <VerificationStep text="Upload a document — 'process-document' function appears in the dashboard" darkMode={darkMode} />
          <VerificationStep text="View step-by-step execution and logs in the Inngest timeline" darkMode={darkMode} />
        </div>
      </Section>

      {/* Troubleshooting */}
      <Section title="Troubleshooting" darkMode={darkMode}>
        <div className="space-y-4">
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'}`}>
            <h4 className={`font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              App crashes with &quot;INNGEST_EVENT_KEY is required in production&quot;
            </h4>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Set <code className={`px-1 py-0.5 rounded text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>INNGEST_EVENT_KEY=dev-placeholder</code> in
              your <code className={`px-1 py-0.5 rounded text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>.env</code> file.
              Any non-empty value works for local development.
            </p>
          </div>
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'}`}>
            <h4 className={`font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Inngest dashboard shows no functions
            </h4>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              Make sure Next.js is running and the Inngest dev server can reach <code className={`px-1 py-0.5 rounded text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>http://localhost:3000/api/inngest</code>.
              If you started them separately, use <code className={`px-1 py-0.5 rounded text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>pnpm dev</code> instead so they start together.
            </p>
          </div>
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'}`}>
            <h4 className={`font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Running Inngest dev server separately
            </h4>
            <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
              If you prefer to run them in separate terminals, start Next.js
              with <code className={`px-1 py-0.5 rounded text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>pnpm dev:next</code> and
              Inngest with <code className={`px-1 py-0.5 rounded text-xs ${darkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>pnpm inngest:dev</code>.
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
  darkMode: boolean;
}

const BenefitCard: React.FC<BenefitCardProps> = ({ icon, title, description, darkMode }) => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className={`p-5 rounded-xl border ${
      darkMode
        ? 'bg-gray-800/50 border-gray-700 hover:border-emerald-600/50'
        : 'bg-white border-gray-200 hover:border-emerald-400'
    } transition-colors`}
  >
    <div className={`mb-3 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`}>{icon}</div>
    <h3 className={`font-semibold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h3>
    <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{description}</p>
  </motion.div>
);

interface PipelineStepProps {
  step: string;
  title: string;
  description: string;
  darkMode: boolean;
}

const PipelineStep: React.FC<PipelineStepProps> = ({ step, title, description, darkMode }) => (
  <div className="flex items-start gap-4">
    <div
      className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm ${
        darkMode ? 'bg-emerald-900/50 text-emerald-400' : 'bg-emerald-100 text-emerald-700'
      }`}
    >
      {step}
    </div>
    <div>
      <h4 className={`font-medium ${darkMode ? 'text-white' : 'text-gray-900'}`}>{title}</h4>
      <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{description}</p>
    </div>
  </div>
);

interface VerificationStepProps {
  text: string;
  darkMode: boolean;
}

const VerificationStep: React.FC<VerificationStepProps> = ({ text, darkMode }) => (
  <div className="flex items-center gap-3">
    <CheckCircle2 className={`w-5 h-5 ${darkMode ? 'text-emerald-400' : 'text-emerald-600'}`} />
    <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>{text}</span>
  </div>
);
