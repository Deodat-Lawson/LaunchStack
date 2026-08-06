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

type Endpoint = {
  id: string;
  name: string;
  summary: string;
  link: string;
  bullets: string[];
  envKey: string;
};

/**
 * Every entry below is the *same* integration — one OpenAI-compatible
 * endpoint — differing only in URL and credential. There is no provider
 * switch to flip, because there are no providers.
 */
const ENDPOINTS: Endpoint[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    summary: 'One key, many vendors',
    link: 'https://openrouter.ai/keys',
    bullets: [
      'Convenient quick start for open-source deployments',
      'One credential can address models from many vendors',
      'Vendor-qualified model ids like vendor/model-name',
    ],
    envKey: 'CHAT_BASE_URL=https://openrouter.ai/api/v1\nCHAT_API_KEY=<your-openrouter-api-key>',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    summary: 'Direct vendor API',
    link: 'https://platform.openai.com/api-keys',
    bullets: [
      'Direct vendor API without an aggregation layer',
      'Bundled presets cover the gpt-4o and gpt-5 families',
      'Most thoroughly tested path end-to-end',
    ],
    envKey: 'CHAT_BASE_URL=https://api.openai.com/v1\nCHAT_API_KEY=<your-openai-api-key>',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    summary: 'Third-party compatible API',
    link: 'https://www.minimax.io',
    bullets: [
      'Example of an endpoint with no bundled preset',
      'Declare the model behavior once in chat-models.yaml',
      'Start conservative and enable capabilities as you verify them',
    ],
    envKey: 'CHAT_BASE_URL=https://api.minimax.io/v1\nCHAT_API_KEY=your_key_here',
  },
  {
    id: 'ollama',
    name: 'Ollama (self-hosted)',
    summary: 'Keyless local endpoint',
    link: 'https://ollama.com',
    bullets: [
      'Run models on your own hardware — no per-token cost',
      'Use the OpenAI-compatible /v1 surface, not the native API',
      'Leave CHAT_API_KEY unset; a placeholder is sent instead',
    ],
    envKey: 'CHAT_BASE_URL=http://localhost:11434/v1\n# CHAT_API_KEY intentionally unset',
  },
  {
    id: 'local-server',
    name: 'vLLM / llama.cpp / LM Studio',
    summary: 'Self-hosted inference server',
    link: 'https://github.com/launchstack/launchstack/blob/main/docs/chat-models.md',
    bullets: [
      'Any server implementing POST /chat/completions',
      'Works air-gapped alongside the bundled Docker stack',
      'CHAT_API_KEY optional, depending on how you fronted it',
    ],
    envKey: 'CHAT_BASE_URL=http://localhost:8080/v1\n# CHAT_API_KEY=optional',
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
        <h1 className={styles.heroTitle}>Chat models</h1>
        <p className={styles.heroSub}>
          Launchstack talks to <span className={styles.serif}>one chat endpoint</span> that speaks
          the OpenAI chat-completions protocol — and that endpoint can serve many models. Point it
          anywhere; the orchestration, RAG, and analysis layers stay the same.
        </p>
      </motion.div>

      <Section
        title="Point at an endpoint"
        subtitle="Two variables. Every option below is the same integration with a different URL."
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
          }}
        >
          {ENDPOINTS.map((e) => (
            <EndpointCard
              key={e.id}
              endpoint={e}
              copied={copiedCode === `endpoint-${e.id}`}
              onCopy={() => copyToClipboard(e.envKey, `endpoint-${e.id}`)}
            />
          ))}
        </div>
      </Section>

      <Section
        title="Assign models to routes"
        subtitle="apps/web/config/chat-models.yaml — non-secret, version-controlled, reviewed like code."
      >
        <CodeBlock
          code={MODELS_YAML}
          onCopy={() => copyToClipboard(MODELS_YAML, 'models-yaml')}
          copied={copiedCode === 'models-yaml'}
        />
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className={styles.calloutInfo}>
            <Lightbulb size={18} className={styles.calloutInfoIcon} style={{ marginTop: 1 }} />
            <div>
              <strong>A route is a job, not a model.</strong> Features ask for{' '}
              <code className={styles.mono}>default</code>, <code className={styles.mono}>fast</code>,{' '}
              <code className={styles.mono}>reasoning</code>, or <code className={styles.mono}>vision</code>;
              you decide which model serves each. Unassigned routes inherit{' '}
              <code className={styles.mono}>default</code> — but only when that model actually has
              the capability.
            </div>
          </div>
          <div className={styles.calloutWarn}>
            <ShieldAlert size={18} className={styles.calloutWarnIcon} style={{ marginTop: 1 }} />
            <div>
              <strong>Behavior is declared, never guessed.</strong> A model either references a
              bundled preset or declares its own behavior in full — nothing is inferred from the
              model id. Specialized routes fail closed: with no vision-capable model configured, the
              image control disables itself rather than sending an image to a model that will ignore
              it.
            </div>
          </div>
          <div className={styles.calloutInfo}>
            <Sparkles size={18} className={styles.calloutInfoIcon} style={{ marginTop: 1 }} />
            <div>
              <strong>Mix and match.</strong> Chat, embeddings, and OCR are independently
              configured, and none of them borrows another&apos;s credential.
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

const EndpointCard: React.FC<{ endpoint: Endpoint; copied: boolean; onCopy: () => void }> = ({
  endpoint: provider,
  copied,
  onCopy,
}) => (
  <div className={`${styles.panel} ${styles.panelHover}`} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>{provider.name}</h3>
        <code className={styles.mono} style={{ fontSize: 11, color: 'var(--ink-3)' }}>
          {provider.summary}
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

const MODELS_YAML = `version: 1

models:
  # Behavior from a bundled, source-dated preset.
  workhorse:
    id: openai/gpt-4o
    preset: openai/gpt-4o

  # Cheaper model for extraction and query planning.
  cheap:
    id: openai/gpt-4o-mini
    preset: openai/gpt-4o-mini

  # No preset? Declare the behavior yourself — nothing is guessed.
  thirdparty:
    id: MiniMax-M2
    behavior:
      input: [text]
      reasoning:
        mode: none
      nativeStructuredOutput: []
      parameters:
        temperature: supported
        systemMessages: supported
        streaming: supported
        maxOutputTokens: supported

routes:
  default: workhorse      # required
  fast: cheap             # inherits default when omitted
  vision: workhorse       # needs a model declaring image input
  # reasoning:            # omit and it inherits default, if capable`;
