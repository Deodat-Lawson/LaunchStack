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
  AlertTriangle,
  Sparkles,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step, ApiKeyCard, InfoBox, WarningBox } from '../ui';

export const InngestPage: React.FC<DeploymentProps> = ({
  darkMode,
  copyToClipboard,
  copiedCode,
}) => {
  return (
    <>
      {/* Hero Section */}
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
          Optional Integration
        </div>

        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-emerald-500 to-teal-600 bg-clip-text text-transparent">
          Inngest Background Jobs
        </h1>

        <p className={`text-xl ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Reliable background processing for document OCR pipelines with automatic retries,
          observability, and step-based execution.
        </p>

        <div
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium ${
            darkMode
              ? 'bg-amber-900/30 text-amber-300 border border-amber-700/50'
              : 'bg-amber-50 text-amber-700 border border-amber-200'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          INNGEST_EVENT_KEY is required for background document processing
        </div>
      </motion.div>

      {/* Benefits Section */}
      <Section title="Why Use Inngest?" darkMode={darkMode}>
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

      {/* How It Works */}
      <Section title="How the Pipeline Works" darkMode={darkMode}>
        <div
          className={`rounded-xl p-6 ${
            darkMode ? 'bg-gray-800/50 border border-gray-700' : 'bg-gray-50 border border-gray-200'
          }`}
        >
          <div className="space-y-4">
            <PipelineStep
              step="A"
              title="Router"
              description="Analyzes PDF to determine: native text extraction or OCR needed? Which provider (Azure, Landing.AI)?"
              darkMode={darkMode}
            />
            <PipelineStep
              step="B"
              title="Normalize"
              description="Extracts content using the selected provider. Outputs standardized PageContent[] structure."
              darkMode={darkMode}
            />
            <PipelineStep
              step="C"
              title="Chunking"
              description="Splits pages into semantic chunks (500 tokens, 50 overlap). Separates tables from text."
              darkMode={darkMode}
            />
            <PipelineStep
              step="D"
              title="Vectorize"
              description="Generates embeddings via OpenAI text-embedding-3-large (1536 dimensions)."
              darkMode={darkMode}
            />
            <PipelineStep
              step="E"
              title="Storage"
              description="Persists chunks with vectors to PostgreSQL. Updates document and job status."
              darkMode={darkMode}
            />
          </div>
        </div>

        <InfoBox
          title="Without Inngest"
          icon={<AlertTriangle className="w-6 h-6" />}
          darkMode={darkMode}
        >
          <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
            When Inngest is not configured, the same pipeline runs <strong>synchronously</strong> using{' '}
            <code className={`${darkMode ? 'bg-gray-800' : 'bg-gray-100'} px-2 py-0.5 rounded`}>
              processDocumentSync()
            </code>
            . The request returns immediately (fire-and-forget) via <code className={`${darkMode ? 'bg-gray-800' : 'bg-gray-100'} px-2 py-0.5 rounded`}>setImmediate()</code>, but there are no retries or observability.
          </p>
        </InfoBox>
      </Section>

      {/* Setup Steps */}
      <Section title="Development Setup" darkMode={darkMode}>
        <div className="space-y-8">
          <Step
            number={1}
            title="Start Inngest Dev Server"
            description="No account needed for local development. The dev server provides a local dashboard."
            code="npx inngest-cli@latest dev"
            onCopy={() => copyToClipboard('npx inngest-cli@latest dev', 'inngest-1')}
            copied={copiedCode === 'inngest-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Start Next.js (in a separate terminal)"
            code="pnpm dev"
            onCopy={() => copyToClipboard('pnpm dev', 'inngest-2')}
            copied={copiedCode === 'inngest-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Open Inngest Dashboard"
            description="View jobs, steps, and logs in your browser:"
            code="http://localhost:8288"
            onCopy={() => copyToClipboard('http://localhost:8288', 'inngest-3')}
            copied={copiedCode === 'inngest-3'}
            darkMode={darkMode}
          />
        </div>

        <div className="mt-8">
          <WarningBox
            title="Key Required in All Environments"
            description="INNGEST_EVENT_KEY is required in development and production. For local dev, use the same key or a dev key from the Inngest dashboard; the Inngest dev server works with both."
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* Production Setup */}
      <Section title="Production Setup" darkMode={darkMode}>
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
              'Go to Settings → Signing Key',
              'Copy INNGEST_SIGNING_KEY to your environment',
              'Go to Settings → Event Keys → Create Key',
              'Copy INNGEST_EVENT_KEY to your environment',
            ]}
            darkMode={darkMode}
          />
        </div>

        <Step
          number={1}
          title="Add Environment Variables"
          description="Add these to your production environment (required for background job processing):"
          code={`# Inngest Background Jobs (Required)
INNGEST_EVENT_KEY=your_event_key_here
INNGEST_SIGNING_KEY=signkey-prod-xxxxx`}
          onCopy={() =>
            copyToClipboard(
              `# Inngest Background Jobs (Required)
INNGEST_EVENT_KEY=your_event_key_here
INNGEST_SIGNING_KEY=signkey-prod-xxxxx`,
              'inngest-prod-1'
            )
          }
          copied={copiedCode === 'inngest-prod-1'}
          darkMode={darkMode}
        />
      </Section>

      {/* Architecture */}
      <Section title="Architecture" darkMode={darkMode}>
        <div
          className={`rounded-xl p-6 font-mono text-sm ${
            darkMode ? 'bg-gray-900 text-gray-300' : 'bg-gray-900 text-gray-300'
          }`}
        >
          <pre className="overflow-x-auto">
            {`┌─────────────────────────────────────────────────────────────┐
│                    Document Upload                          │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│              triggerDocumentProcessing()                    │
│  INNGEST_EVENT_KEY required → Send event to job runner     │
│  (Key validated at startup; no sync fallback)               │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                    Inngest Cloud                            │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐ │
│  │ Step A  │→│ Step B  │→│ Step C  │→│ Step D  │→│ Step E│ │
│  │ Router  │ │Normalize│ │ Chunk   │ │Vectorize│ │ Store │ │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └───────┘ │
│                                                             │
│  ✓ Automatic retries    ✓ Step isolation    ✓ Observability │
└─────────────────────────────────────────────────────────────┘`}
          </pre>
        </div>
      </Section>

      {/* Verification */}
      <Section title="Verify Setup" darkMode={darkMode}>
        <div className="space-y-4">
          <VerificationStep
            text="Inngest dev server running at localhost:8288"
            darkMode={darkMode}
          />
          <VerificationStep
            text="Next.js app registered at localhost:8288 (shows 'pdr-ai' app)"
            darkMode={darkMode}
          />
          <VerificationStep
            text="Upload a document and see 'process-document' function triggered"
            darkMode={darkMode}
          />
          <VerificationStep
            text="View step-by-step execution in the Inngest dashboard"
            darkMode={darkMode}
          />
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

