'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  Terminal,
  Shield,
  Key,
  Rocket,
  Container,
  ArrowRight,
  Github,
  ExternalLink,
  Play,
  Zap,
  Database,
  Video,
  ShieldAlert,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step } from '../ui';

/* ------------------------------------------------------------------ */
/*  Inline sub-components (LangSmith-style cards & callouts)          */
/* ------------------------------------------------------------------ */

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
      <h3 className={`font-semibold mb-1 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h3>
      <div className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
        {children}
      </div>
    </div>
  </div>
);

interface NavCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  href?: string;
  darkMode: boolean;
}

const NavCard: React.FC<NavCardProps> = ({ icon, title, description, cta, href, darkMode }) => {
  const Wrapper = href ? 'a' : 'div';
  const linkProps = href ? { href, target: '_blank' as const, rel: 'noopener noreferrer' as const } : {};

  return (
    <Wrapper
      {...linkProps}
      className={`group flex flex-col justify-between p-6 rounded-xl border transition-all duration-200 cursor-pointer ${
        darkMode
          ? 'bg-gray-800/60 border-gray-700/60 hover:border-purple-500/50 hover:bg-gray-800'
          : 'bg-white border-gray-200 hover:border-purple-300 hover:shadow-lg'
      }`}
    >
      <div>
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${
            darkMode ? 'bg-purple-500/15 text-purple-400' : 'bg-purple-100 text-purple-600'
          }`}
        >
          {icon}
        </div>
        <h3 className={`font-semibold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
          {title}
        </h3>
        <p className={`text-sm leading-relaxed ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {description}
        </p>
      </div>
      <div className="flex items-center gap-1.5 mt-4 text-sm font-medium text-purple-500 group-hover:text-purple-400 transition-colors">
        {cta}
        <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Wrapper>
  );
};

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

/* ------------------------------------------------------------------ */
/*  Main page                                                          */
/* ------------------------------------------------------------------ */

export const MainDeployment: React.FC<DeploymentProps> = ({
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
          Deploy Launchstack
        </h1>

        <p className={`text-xl leading-relaxed max-w-2xl ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          Launchstack is an AI-powered document analysis platform. Set up your accounts, configure environment variables, and deploy to production in minutes.
        </p>

        <div className="flex flex-wrap gap-3 mt-8">
          <a
            href="https://github.com/Deodat-Lawson/pdr_ai_v2"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all duration-200 text-sm"
          >
            <Github className="w-4 h-4" />
            View on GitHub
          </a>
        </div>
      </motion.div>

      <Divider darkMode={darkMode} />

      {/* ── Get started ── */}
      <Section
        title="Get started"
        subtitle="Three things to set up before running the app."
        darkMode={darkMode}
      >
        <div className="space-y-4">
          <StepCard icon={<Shield className="w-5 h-5" />} title="Generate a Better Auth secret" darkMode={darkMode}>
            Run <code>openssl rand -base64 32</code> to generate a strong random secret for <strong>BETTER_AUTH_SECRET</strong>. No external account needed — authentication runs entirely on your own infrastructure.
          </StepCard>

          <StepCard icon={<Key className="w-5 h-5" />} title="Create an OpenAI API key" darkMode={darkMode}>
            Go to{' '}
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-500 hover:underline inline-flex items-center gap-1"
            >
              platform.openai.com/api-keys <ExternalLink className="w-3 h-3" />
            </a>
            . Create a new secret key and save it securely.
          </StepCard>

          <StepCard icon={<Database className="w-5 h-5" />} title="Set up a database" darkMode={darkMode}>
            Create a PostgreSQL 14+ instance at{' '}
            <a
              href="https://neon.tech"
              target="_blank"
              rel="noopener noreferrer"
              className="text-purple-500 hover:underline inline-flex items-center gap-1"
            >
              neon.tech <ExternalLink className="w-3 h-3" />
            </a>
            {' '}(recommended) and copy the connection string.
          </StepCard>

          <StepCard icon={<Database className="w-5 h-5" />} title="Create a Vercel Blob store" darkMode={darkMode}>
            In your Vercel project, go to <strong>Storage → Create Database → Blob</strong> and connect it to your project.
            This provides the <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1 py-0.5 rounded text-xs`}>BLOB_READ_WRITE_TOKEN</code> needed
            for document uploads. See the <strong>Vercel Blob</strong> page in the sidebar for details.
          </StepCard>
        </div>
      </Section>

      {/* ── Quick start steps ── */}
      <Section
        title="Quick start"
        subtitle="Once your accounts and keys are ready, follow these steps to run Launchstack locally."
        darkMode={darkMode}
      >
        <div className="space-y-6">
          <Step
            number={1}
            title="Clone the repository"
            code="git clone https://github.com/Deodat-Lawson/pdr_ai_v2.git\ncd pdr_ai_v2"
            onCopy={() => copyToClipboard('git clone https://github.com/Deodat-Lawson/pdr_ai_v2.git\ncd pdr_ai_v2', 'step-1')}
            copied={copiedCode === 'step-1'}
            darkMode={darkMode}
          />

          <Step
            number={2}
            title="Install dependencies"
            code="pnpm install"
            onCopy={() => copyToClipboard('pnpm install', 'step-2')}
            copied={copiedCode === 'step-2'}
            darkMode={darkMode}
          />

          <Step
            number={3}
            title="Configure environment variables"
            description="Create a .env file at the project root with the keys you collected above."
            code={`DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"

BETTER_AUTH_SECRET=your_generated_secret_here
BETTER_AUTH_URL=http://localhost:3000

OPENAI_API_KEY=sk-proj-your_key_here

# Vercel Blob — required for document uploads
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx

# Inngest — use a placeholder for local dev
INNGEST_EVENT_KEY=dev-placeholder`}
            onCopy={() => copyToClipboard(`DATABASE_URL="postgresql://user:password@host:5432/database?sslmode=require"\n\nBETTER_AUTH_SECRET=your_generated_secret_here\nBETTER_AUTH_URL=http://localhost:3000\n\nOPENAI_API_KEY=sk-proj-your_key_here\n\nBLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx\n\nINNGEST_EVENT_KEY=dev-placeholder`, 'step-3')}
            copied={copiedCode === 'step-3'}
            darkMode={darkMode}
          />

          <Step
            number={4}
            title="Set up the database"
            code="pnpm db:push"
            onCopy={() => copyToClipboard('pnpm db:push', 'step-4')}
            copied={copiedCode === 'step-4'}
            darkMode={darkMode}
          />

          <Step
            number={5}
            title="Start development server"
            code="pnpm dev"
            onCopy={() => copyToClipboard('pnpm dev', 'step-5')}
            copied={copiedCode === 'step-5'}
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Choose your deployment path ── */}
      <Section
        title="Choose a deployment path"
        subtitle="Pick the option that fits your infrastructure."
        darkMode={darkMode}
      >
        <div className="grid md:grid-cols-2 gap-5">
          <NavCard
            icon={<Rocket className="w-5 h-5" />}
            title="Vercel"
            description="Managed hosting with auto-deploys from GitHub. Connects to Neon serverless for the database."
            cta="Open Vercel guide"
            darkMode={darkMode}
          />
          <NavCard
            icon={<Container className="w-5 h-5" />}
            title="Docker"
            description="Self-hosted stack via Docker Compose. Includes db, migrate, and app services out of the box."
            cta="Open Docker guide"
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* ── Required integrations ── */}
      <Section
        title="Required integrations"
        subtitle="These services must be configured for Launchstack to function."
        darkMode={darkMode}
      >
        <div className="grid sm:grid-cols-2 gap-5">
          <NavCard
            icon={<Database className="w-5 h-5" />}
            title="Vercel Blob"
            description="Cloud file storage for document uploads. Required — there is no database fallback."
            cta="Set up Vercel Blob"
            darkMode={darkMode}
          />
          <NavCard
            icon={<Zap className="w-5 h-5" />}
            title="Inngest"
            description="Background job processing for document analysis pipelines."
            cta="Set up Inngest"
            darkMode={darkMode}
          />
        </div>
      </Section>

      {/* ── Optional integrations ── */}
      <Section
        title="Optional integrations"
        subtitle="Additional services you can enable via environment variables."
        darkMode={darkMode}
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          <NavCard
            icon={<Terminal className="w-5 h-5" />}
            title="LangChain Tracing"
            description="Observe and debug every LLM call with LangSmith."
            cta="Set up tracing"
            href="https://smith.langchain.com"
            darkMode={darkMode}
          />
          <NavCard
            icon={<Shield className="w-5 h-5" />}
            title="OCR Services"
            description="Azure, Landing.AI, or Datalab for scanned document extraction."
            cta="Configure OCR"
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Video walkthroughs ── */}
      <Section
        title="Video walkthroughs"
        subtitle="Short looping demos for key setup steps. Drop your recordings into the paths shown below."
        darkMode={darkMode}
      >
        <div className="grid md:grid-cols-2 gap-6">
          <div
            className={`rounded-xl border overflow-hidden ${
              darkMode ? 'border-gray-700/60 bg-gray-800/40' : 'border-gray-200 bg-white'
            }`}
          >
            <video
              src="/deployment-demos/auth-setup.mov"
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
                  Auth Setup
                </h4>
              </div>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded`}>
                  public/deployment-demos/auth-setup.mov
                </code>
              </p>
            </div>
          </div>

          <div
            className={`rounded-xl border overflow-hidden ${
              darkMode ? 'border-gray-700/60 bg-gray-800/40' : 'border-gray-200 bg-white'
            }`}
          >
            <video
              src="/deployment-demos/openai-api-key-setup.mov"
              controls
              loop
              muted
              playsInline
              className="w-full aspect-video bg-black"
            />
            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <Video className="w-4 h-4 text-purple-500" />
                <h4 className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-gray-900'}`}>
                  OpenAI API Key Setup
                </h4>
              </div>
              <p className={`text-xs ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                <code className={`${darkMode ? 'bg-gray-900' : 'bg-gray-100'} px-1.5 py-0.5 rounded`}>
                  public/deployment-demos/openai-api-key-setup.mov
                </code>
              </p>
            </div>
          </div>
        </div>
      </Section>

      <Divider darkMode={darkMode} />

      {/* ── Callouts ── */}
      <div className="space-y-4 mb-16">
        <Callout icon={<ShieldAlert className="w-5 h-5" />} darkMode={darkMode} variant="warning">
          <strong>Security:</strong> Never commit API keys or secrets to git. Use <code className={`${darkMode ? 'bg-gray-800' : 'bg-yellow-100'} px-1.5 py-0.5 rounded text-xs`}>.env</code> locally and environment variable settings in Vercel or Docker for production.
        </Callout>

        <Callout icon={<Shield className="w-5 h-5" />} darkMode={darkMode} variant="info">
          Need help with authentication configuration? Open the <strong>Auth Setup</strong> tab in the sidebar for a full walkthrough.
        </Callout>
      </div>
    </>
  );
};
