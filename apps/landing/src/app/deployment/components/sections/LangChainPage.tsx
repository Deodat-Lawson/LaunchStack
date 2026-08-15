'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Eye, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';
import styles from '~/styles/deployment.module.css';

export const LangChainPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  const bullets = [
    'Trace every LLM, retriever, and tool call end-to-end',
    'Debug chains, agents, and prompt-template variations',
    'Monitor latency and token usage per run',
    'Inspect prompt effectiveness across runs',
  ];

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: 36 }}
      >
        <div className={styles.pill} style={{ marginBottom: 18 }}>
          <Eye size={12} /> Optional
        </div>
        <h1 className={styles.heroTitle}>LangSmith tracing</h1>
        <p className={styles.heroSub}>
          Observability for the LangChain runs that power RAG, analysis, and generation.
        </p>
      </motion.div>

      <Section title="What you get">
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bullets.map((b) => (
            <li key={b} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--ink-2)', lineHeight: 1.55 }}>
              <Check size={16} className={styles.okIcon} style={{ marginTop: 3 }} />
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Setup instructions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <h3 style={h3}>Step 1: Create a LangSmith account</h3>
            <p style={p}>
              Visit{' '}
              <a href="https://smith.langchain.com" target="_blank" rel="noopener noreferrer" style={link}>
                smith.langchain.com <ExternalLink size={12} />
              </a>{' '}
              and create an account.
            </p>
          </div>
          <div>
            <h3 style={h3}>Step 2: Get API key</h3>
            <p style={p}>Settings → API Keys → generate a new key.</p>
          </div>
          <div>
            <h3 style={h3}>Step 3: Add to environment variables</h3>
            <CodeBlock
              code={`LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_your_key_here
LANGCHAIN_PROJECT=launchstack`}
              onCopy={() =>
                copyToClipboard(
                  'LANGCHAIN_TRACING_V2=true\nLANGCHAIN_API_KEY=lsv2_pt_your_key_here\nLANGCHAIN_PROJECT=launchstack',
                  'langchain-env',
                )
              }
              copied={copiedCode === 'langchain-env'}
            />
          </div>
          <div>
            <h3 style={h3}>Step 4: View traces</h3>
            <p style={p}>
              Once configured, LangChain operations are automatically traced. View them at{' '}
              <a href="https://smith.langchain.com" target="_blank" rel="noopener noreferrer" style={link}>
                smith.langchain.com
              </a>
              .
            </p>
          </div>
        </div>
      </Section>
    </>
  );
};

const h3: React.CSSProperties = { margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: 'var(--ink)' };
const p: React.CSSProperties = { margin: '0 0 10px', color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 14 };
const link: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 };
