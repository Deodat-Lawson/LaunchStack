'use client';

import React from 'react';
import { motion } from 'motion/react';
import {
  BrainCircuit,
  Sparkles,
  ShieldAlert,
  Lightbulb,
  ExternalLink,
  Check,
} from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';
import styles from '~/styles/deployment.module.css';

type Provider = {
  id: string;
  name: string;
  defaultModel: string;
  link: string;
  bullets: string[];
  envKey: string;
};

const PROVIDERS: Provider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    link: 'https://platform.openai.com/api-keys',
    bullets: [
      'Default chat model out of the box',
      'text-embedding-3-large used for embeddings',
      'Most thoroughly tested path end-to-end',
    ],
    envKey: 'OPENAI_API_KEY=sk-proj-your_key_here',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-6',
    link: 'https://console.anthropic.com',
    bullets: [
      'Drop-in Claude Sonnet / Opus / Haiku',
      'Longer-context reasoning for legal and analysis flows',
      'Works with the same orchestration layer as OpenAI',
    ],
    envKey: 'ANTHROPIC_API_KEY=sk-ant-your_key_here',
  },
  {
    id: 'google',
    name: 'Google AI',
    defaultModel: 'gemini-2.5-pro',
    link: 'https://aistudio.google.com/app/apikey',
    bullets: [
      'Gemini 2.5 family for multimodal inputs',
      'Cost-efficient embeddings via text-embedding-004',
      'Useful for image-heavy documents',
    ],
    envKey: 'GOOGLE_API_KEY=your_google_ai_key_here',
  },
  {
    id: 'ollama',
    name: 'Ollama (self-hosted)',
    defaultModel: 'llama3.1:70b',
    link: 'https://ollama.com',
    bullets: [
      'Run models on your own hardware — no per-token cost',
      'Pair with the bundled Docker compose for an air-gapped stack',
      'Supports embedding models (nomic-embed-text, bge-m3)',
    ],
    envKey: 'OLLAMA_BASE_URL=http://localhost:11434',
  },
  {
    id: 'siliconflow',
    name: 'SiliconFlow',
    defaultModel: 'Qwen/Qwen2.5-72B-Instruct',
    link: 'https://siliconflow.cn',
    bullets: [
      'OpenAI-compatible API with open-weight models',
      'Cheaper token pricing for high-volume routes',
      'Good fallback for regions where OpenAI is restricted',
    ],
    envKey: 'SILICONFLOW_API_KEY=your_siliconflow_key_here',
  },
];

export const AIProvidersPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: 44 }}
      >
        <div className={styles.pill} style={{ marginBottom: 18 }}>
          <BrainCircuit size={12} /> Core
        </div>
        <h1 className={styles.heroTitle}>AI model providers</h1>
        <p className={styles.heroSub}>
          Launchstack is <span className={styles.serif}>provider-agnostic</span>. Pick one from the
          list below, swap it for another whenever you want — the orchestration, RAG, and analysis
          layers stay the same.
        </p>
      </motion.div>

      <Section title="Pick a chat model" subtitle="Any one of these is enough to boot the app.">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {PROVIDERS.map((p) => (
            <ProviderCard
              key={p.id}
              provider={p}
              copied={copiedCode === `provider-${p.id}`}
              onCopy={() => copyToClipboard(p.envKey, `provider-${p.id}`)}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Switch providers with one flag"
        subtitle="The orchestrator reads these env vars to route chat, embeddings, and reranking."
      >
        <CodeBlock
          code={SWITCH_ENV}
          onCopy={() => copyToClipboard(SWITCH_ENV, 'switch-env')}
          copied={copiedCode === 'switch-env'}
        />
        <div style={{ marginTop: 14 }}>
          <div className={styles.calloutInfo}>
            <Lightbulb size={18} className={styles.calloutInfoIcon} style={{ marginTop: 1 }} />
            <div>
              <strong>Mix and match.</strong> Chat and embeddings are independent — e.g. Claude for
              chat with OpenAI embeddings is a common pairing.
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Embeddings & reranking"
        subtitle="RAG retrieval quality lives here — choose once, reuse everywhere."
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <InlineRow
            title="Embeddings"
            badge="Default: OpenAI text-embedding-3-large"
            body="Swap for Hugging Face BGE-M3, Ollama nomic-embed-text, or Google text-embedding-004. Re-run pnpm db:reindex after switching so existing chunks get re-embedded with the new model."
          />
          <InlineRow
            title="Reranker"
            badge="Default: Jina jina-reranker-v2-base-multilingual"
            body="Optional but recommended for high-precision retrieval. Set JINA_API_KEY or disable via ENABLE_RERANKER=false."
          />
        </div>
      </Section>

      <Section title="Production notes">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className={styles.calloutWarn}>
            <ShieldAlert size={18} className={styles.calloutWarnIcon} style={{ marginTop: 1 }} />
            <div>
              <strong>Rate limits matter more than raw speed.</strong> Provider throttling on the
              embedding route will surface as stuck document uploads. Start with conservative batch
              sizes (<code className={styles.mono}>EMBED_BATCH_SIZE=16</code>) when moving to a new
              provider.
            </div>
          </div>
          <div className={styles.calloutInfo}>
            <Sparkles size={18} className={styles.calloutInfoIcon} style={{ marginTop: 1 }} />
            <div>
              <strong>Cost visibility.</strong> Enable LangSmith tracing (see the LangChain Tracing
              page) to see per-run token usage across providers — invaluable when deciding where to
              route each workload.
            </div>
          </div>
        </div>
      </Section>
    </>
  );
};

const ProviderCard: React.FC<{ provider: Provider; copied: boolean; onCopy: () => void }> = ({
  provider,
  copied,
  onCopy,
}) => (
  <div className={`${styles.panel} ${styles.panelHover}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{provider.name}</h3>
        <code className={styles.mono} style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {provider.defaultModel}
        </code>
      </div>
      <a
        href={provider.link}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--accent)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          fontWeight: 500,
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        Get key <ExternalLink size={11} />
      </a>
    </div>
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {provider.bullets.map((b) => (
        <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          <Check size={14} className={styles.okIcon} style={{ marginTop: 2 }} />
          <span>{b}</span>
        </li>
      ))}
    </ul>
    <div style={{ marginTop: 2 }}>
      <CodeBlock code={provider.envKey} copied={copied} onCopy={onCopy} />
    </div>
  </div>
);

const InlineRow: React.FC<{ title: string; badge: string; body: string }> = ({ title, badge, body }) => (
  <div className={styles.panel}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{title}</h3>
      <span className={styles.pillMuted}>{badge}</span>
    </div>
    <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>{body}</p>
  </div>
);

const SWITCH_ENV = `# Primary chat model — set ONE of:
OPENAI_API_KEY=sk-proj-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
SILICONFLOW_API_KEY=...
OLLAMA_BASE_URL=http://localhost:11434

# Route selection (falls back to whichever key is present)
CHAT_PROVIDER=openai       # openai | anthropic | google | siliconflow | ollama
CHAT_MODEL=gpt-5-mini      # provider-specific model id

# Embeddings
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-large

# Reranker (optional)
RERANKER_PROVIDER=jina
JINA_API_KEY=jina_your_key`;
