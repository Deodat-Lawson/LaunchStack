'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Search as SearchIcon, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, WarningBox } from '../ui';
import styles from '~/styles/deployment.module.css';

export const ExaPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  const bullets = [
    'Hybrid neural + keyword web search for document context',
    'Verify information from external sources',
    'Enrich AI responses with current data',
    'Research and fact-checking for agents',
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
          <SearchIcon size={12} /> Optional
        </div>
        <h1 className={styles.heroTitle}>Exa search</h1>
        <p className={styles.heroSub}>
          Semantic web search used by the trend and research agents.
        </p>
      </motion.div>

      <Section title="What Exa enables">
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
            <h3 style={h3}>Step 1: Create an Exa account</h3>
            <p style={p}>
              Visit{' '}
              <a href="https://exa.ai" target="_blank" rel="noopener noreferrer" style={link}>
                exa.ai <ExternalLink size={12} />
              </a>{' '}
              and sign up.
            </p>
          </div>
          <div>
            <h3 style={h3}>Step 2: Generate API key</h3>
            <p style={p}>Navigate to your dashboard and generate a new API key.</p>
          </div>
          <div>
            <h3 style={h3}>Step 3: Add to environment variables</h3>
            <CodeBlock
              code={`EXA_API_KEY=your_key_here`}
              onCopy={() => copyToClipboard('EXA_API_KEY=your_key_here', 'exa-env')}
              copied={copiedCode === 'exa-env'}
            />
          </div>
          <WarningBox
            title="Optional dependency"
            description="Exa is only needed for web-search-enabled agents. The core app works without it."
          />
        </div>
      </Section>
    </>
  );
};

const h3: React.CSSProperties = { margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: 'var(--ink)' };
const p: React.CSSProperties = { margin: '0 0 10px', color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 14 };
const link: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 };
