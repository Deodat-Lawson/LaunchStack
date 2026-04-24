'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  Shield,
  Rocket,
  Container,
  ArrowRight,
  Github,
  Database,
  Zap,
  BrainCircuit,
  FileSearch,
  Mic,
  Layers,
  Eye,
  Search as SearchIcon,
  Play,
  Video,
  ExternalLink,
  ShieldAlert,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, Step } from '../ui';
import styles from '~/styles/deployment.module.css';

const GITHUB_REPO = 'https://github.com/Deodat-Lawson/pdr_ai_v2';

type FeatureItem = {
  icon: React.ReactNode;
  title: string;
  description: string;
};

const CAPABILITY_FEATURES: FeatureItem[] = [
  {
    icon: <FileSearch size={18} />,
    title: 'RAG over everything',
    description:
      'PDFs, Office docs, transcripts, repos, and exports — chunked, embedded, and retrieved with pgvector plus optional Jina reranking.',
  },
  {
    icon: <BrainCircuit size={18} />,
    title: 'Predictive analysis',
    description:
      'Eight document classes (contract, financial, compliance, technical, HR, research, educational, general) with per-type recommendations.',
  },
  {
    icon: <Shield size={18} />,
    title: 'Legal generation',
    description:
      'Template-driven DOCX for NDAs, employment, and service agreements, with clause-level AI refinement.',
  },
  {
    icon: <Mic size={18} />,
    title: 'Voice & transcription',
    description:
      'Groq Whisper turns audio and video uploads into searchable documents. ElevenLabs ships answers back as speech.',
  },
  {
    icon: <Zap size={18} />,
    title: 'Marketing pipeline',
    description:
      'Generate and verify platform-specific posts for Reddit, X, LinkedIn, and Bluesky against your own source docs.',
  },
  {
    icon: <Database size={18} />,
    title: 'Pluggable storage',
    description:
      'Vercel Blob by default. S3, UploadThing, and local disk swap in through the storage port.',
  },
];

type StoreCard = {
  icon: React.ReactNode;
  title: string;
  description: string;
  cta: string;
  href?: string;
};

const DEPLOY_PATHS: StoreCard[] = [
  {
    icon: <Rocket size={16} />,
    title: 'Vercel',
    description:
      'Managed hosting with auto-deploys from GitHub. Neon serverless Postgres handles pgvector out of the box.',
    cta: 'Open Vercel guide',
  },
  {
    icon: <Container size={16} />,
    title: 'Docker',
    description:
      'Self-host the full stack with Docker Compose: Postgres + pgvector, migrate, app, and optional OCR sidecars.',
    cta: 'Open Docker guide',
  },
];

const REQUIRED_INTEGRATIONS: StoreCard[] = [
  {
    icon: <BrainCircuit size={16} />,
    title: 'AI providers',
    description:
      'OpenAI by default. Anthropic, Google, SiliconFlow, or local Ollama swap in with a single env flip.',
    cta: 'Pick a provider',
  },
  {
    icon: <Database size={16} />,
    title: 'Vercel Blob',
    description:
      'Primary document storage backend. There is no database-only fallback for uploaded files.',
    cta: 'Configure blob',
  },
  {
    icon: <Layers size={16} />,
    title: 'Inngest',
    description:
      'Event-driven background jobs for OCR, embeddings, analysis, and scheduled content pipelines.',
    cta: 'Set up Inngest',
  },
];

const OPTIONAL_INTEGRATIONS: StoreCard[] = [
  {
    icon: <Eye size={16} />,
    title: 'LangSmith tracing',
    description: 'Observability for every LLM, retriever, and tool call.',
    cta: 'Enable tracing',
    href: 'https://smith.langchain.com',
  },
  {
    icon: <FileSearch size={16} />,
    title: 'OCR services',
    description: 'Azure Document Intelligence or Landing.AI for scanned and complex layouts.',
    cta: 'Choose an OCR',
  },
  {
    icon: <SearchIcon size={16} />,
    title: 'Exa search',
    description: 'Semantic web search for the trend and research agents.',
    cta: 'Wire up Exa',
  },
  {
    icon: <Mic size={16} />,
    title: 'Voice & audio',
    description: 'ElevenLabs voices for TTS answers. Whisper transcription is built-in.',
    cta: 'Configure voice',
  },
];

export const MainDeployment: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55 }}
        style={{ marginBottom: 56 }}
      >
        <div className={styles.eyebrow}>Self-host guide</div>
        <h1 className={styles.heroTitle}>
          Deploy your own <span className={styles.serif}>Launchstack</span>
          <br />
          in under an hour.
        </h1>
        <p className={styles.heroSub}>
          Launchstack is the open-source second brain for founders — docs, recordings, and
          messages turned into a cited knowledge graph. Bring your own API keys, host it
          anywhere, keep your data.
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noopener noreferrer"
            style={primaryCta}
          >
            <Github size={14} />
            View on GitHub
            <ExternalLink size={12} />
          </a>
          <a href="#quick-start" style={ghostCta}>
            Jump to quick start
            <ArrowRight size={14} />
          </a>
        </div>
      </motion.div>

      <Section
        title="What you're shipping"
        subtitle="Everything in the box when you spin up a fresh Launchstack instance."
      >
        <div style={gridCols(2)}>
          {CAPABILITY_FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </div>
      </Section>

      <Section
        title="Get started"
        subtitle="Four accounts to create before your first boot."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <StepCard
            icon={<Shield size={16} />}
            title="Clerk"
            body={
              <>
                Sign up at{' '}
                <a href="https://dashboard.clerk.com" target="_blank" rel="noopener noreferrer" style={link}>
                  dashboard.clerk.com
                </a>
                , create an application, and copy the <strong>Publishable</strong> and{' '}
                <strong>Secret</strong> keys.
              </>
            }
          />
          <StepCard
            icon={<BrainCircuit size={16} />}
            title="An AI provider"
            body={
              <>
                Any one of OpenAI, Anthropic, Google, SiliconFlow, or a local Ollama box. Details on the{' '}
                <strong>AI Model Providers</strong> page.
              </>
            }
          />
          <StepCard
            icon={<Database size={16} />}
            title="PostgreSQL with pgvector"
            body={
              <>
                <a href="https://neon.tech" target="_blank" rel="noopener noreferrer" style={link}>
                  neon.tech
                </a>{' '}
                for serverless, or run the bundled <code className={styles.mono}>postgres + pgvector</code> container for self-hosting.
              </>
            }
          />
          <StepCard
            icon={<Database size={16} />}
            title="Vercel Blob"
            body={
              <>
                Storage → <strong>Create Database → Blob</strong> in your Vercel project. The connector injects{' '}
                <code className={styles.mono}>BLOB_READ_WRITE_TOKEN</code> automatically.
              </>
            }
          />
        </div>
      </Section>

      <div id="quick-start" />
      <Section
        title="Quick start"
        subtitle="Run the app on your machine in five commands."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Step
            number={1}
            title="Clone the repository"
            code={`git clone ${GITHUB_REPO}.git\ncd pdr_ai_v2`}
            onCopy={() =>
              copyToClipboard(`git clone ${GITHUB_REPO}.git\ncd pdr_ai_v2`, 'qs-1')
            }
            copied={copiedCode === 'qs-1'}
          />
          <Step
            number={2}
            title="Install dependencies"
            code="pnpm install"
            onCopy={() => copyToClipboard('pnpm install', 'qs-2')}
            copied={copiedCode === 'qs-2'}
          />
          <Step
            number={3}
            title="Configure environment variables"
            description="Drop a .env at the repo root with at least these keys."
            code={QUICKSTART_ENV}
            onCopy={() => copyToClipboard(QUICKSTART_ENV, 'qs-3')}
            copied={copiedCode === 'qs-3'}
          />
          <Step
            number={4}
            title="Push the schema"
            code="pnpm db:push"
            onCopy={() => copyToClipboard('pnpm db:push', 'qs-4')}
            copied={copiedCode === 'qs-4'}
          />
          <Step
            number={5}
            title="Start the dev server"
            code="pnpm dev"
            onCopy={() => copyToClipboard('pnpm dev', 'qs-5')}
            copied={copiedCode === 'qs-5'}
          />
        </div>
      </Section>

      <Section title="Choose a deployment path" subtitle="Pick what matches your infra.">
        <div style={gridCols(2)}>
          {DEPLOY_PATHS.map((c) => (
            <LinkCard key={c.title} {...c} />
          ))}
        </div>
      </Section>

      <Section
        title="Required integrations"
        subtitle="Must be configured before the app boots cleanly."
      >
        <div style={gridCols(3)}>
          {REQUIRED_INTEGRATIONS.map((c) => (
            <LinkCard key={c.title} {...c} />
          ))}
        </div>
      </Section>

      <Section title="Optional integrations" subtitle="Enable as needed.">
        <div style={gridCols(2)}>
          {OPTIONAL_INTEGRATIONS.map((c) => (
            <LinkCard key={c.title} {...c} />
          ))}
        </div>
      </Section>

      <Section title="Video walkthroughs" subtitle="Short clips for the trickier steps.">
        <div style={gridCols(2)}>
          <DemoCard
            icon={<Play size={14} />}
            title="Clerk setup"
            src="/deployment-demos/clerk-setup.mov"
            path="public/deployment-demos/clerk-setup.mov"
          />
          <DemoCard
            icon={<Video size={14} />}
            title="OpenAI API key"
            src="/deployment-demos/openai-api-key-setup.mov"
            path="public/deployment-demos/openai-api-key-setup.mov"
          />
        </div>
      </Section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
        <div className={styles.calloutWarn}>
          <ShieldAlert size={18} className={styles.calloutWarnIcon} style={{ marginTop: 1 }} />
          <div>
            <strong>Keep secrets out of git.</strong> Commit only <code className={styles.mono}>.env.example</code>.
            Put real keys in your deploy platform&rsquo;s environment variable manager.
          </div>
        </div>
        <div className={styles.calloutInfo}>
          <Shield size={18} className={styles.calloutInfoIcon} style={{ marginTop: 1 }} />
          <div>
            Need help with Clerk? Open the <strong>Clerk Authentication</strong> tab in the sidebar
            for a full walkthrough including redirect URLs and production keys.
          </div>
        </div>
      </div>
    </>
  );
};

/* ---------- inline components ---------- */

const FeatureCard: React.FC<FeatureItem> = ({ icon, title, description }) => (
  <div className={`${styles.panel} ${styles.panelHover}`}>
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 9,
        background: 'var(--accent-soft)',
        color: 'var(--accent-ink)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 12,
      }}
    >
      {icon}
    </div>
    <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
      {title}
    </h3>
    <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
      {description}
    </p>
  </div>
);

const StepCard: React.FC<{ icon: React.ReactNode; title: string; body: React.ReactNode }> = ({
  icon,
  title,
  body,
}) => (
  <div
    style={{
      display: 'flex',
      gap: 14,
      padding: '16px 18px',
      borderRadius: 12,
      background: 'var(--panel)',
      border: '1px solid var(--line-2)',
    }}
  >
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: 'linear-gradient(135deg, var(--accent), var(--accent-deep))',
        color: 'white',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        boxShadow: '0 6px 16px var(--accent-glow)',
      }}
    >
      {icon}
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <h3 style={{ margin: '2px 0 4px', fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>
        {title}
      </h3>
      <div style={{ fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.55 }}>{body}</div>
    </div>
  </div>
);

const LinkCard: React.FC<StoreCard> = ({ icon, title, description, cta, href }) => {
  const Wrapper: React.ElementType = href ? 'a' : 'div';
  return (
    <Wrapper
      {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={`${styles.panel} ${styles.panelHover}`}
      style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', gap: 10, cursor: href ? 'pointer' : 'default' }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          background: 'var(--accent-soft)',
          color: 'var(--accent-ink)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </div>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
        {description}
      </p>
      <div
        style={{
          marginTop: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 13,
          fontWeight: 500,
          color: 'var(--accent)',
        }}
      >
        {cta}
        <ArrowRight size={14} />
      </div>
    </Wrapper>
  );
};

const DemoCard: React.FC<{ icon: React.ReactNode; title: string; src: string; path: string }> = ({
  icon,
  title,
  src,
  path,
}) => (
  <div
    style={{
      borderRadius: 14,
      border: '1px solid var(--line-2)',
      background: 'var(--panel)',
      overflow: 'hidden',
    }}
  >
    <video src={src} controls loop muted playsInline style={{ width: '100%', aspectRatio: '16/9', background: 'black' }} />
    <div style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, color: 'var(--accent)' }}>
        {icon}
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title}</h4>
      </div>
      <code className={styles.mono} style={{ fontSize: 11, color: 'var(--ink-3)' }}>
        {path}
      </code>
    </div>
  </div>
);

/* ---------- style helpers ---------- */

const primaryCta: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderRadius: 10,
  background: 'linear-gradient(180deg, var(--accent) 0%, var(--accent-deep) 100%)',
  color: 'white',
  fontSize: 14,
  fontWeight: 600,
  textDecoration: 'none',
  boxShadow: '0 1px 0 oklch(1 0 0 / 0.35) inset, 0 8px 20px var(--accent-glow)',
};

const ghostCta: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 10,
  border: '1px solid var(--line)',
  color: 'var(--ink)',
  fontSize: 14,
  fontWeight: 500,
  textDecoration: 'none',
  background: 'var(--panel)',
};

const link: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
};

const gridCols = (n: number): React.CSSProperties => ({
  display: 'grid',
  gridTemplateColumns: `repeat(auto-fit, minmax(${n === 2 ? 260 : 220}px, 1fr))`,
  gap: 14,
});

const QUICKSTART_ENV = `DATABASE_URL="postgresql://user:password@host:5432/db?sslmode=require"

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_your_key_here
CLERK_SECRET_KEY=sk_live_your_key_here

# Pick one provider — OpenAI shown, see AI Model Providers for others
OPENAI_API_KEY=sk-proj-your_key_here

# Vercel Blob — required for document uploads
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxx

# Inngest — placeholder is fine for local dev
INNGEST_EVENT_KEY=dev-placeholder`;
