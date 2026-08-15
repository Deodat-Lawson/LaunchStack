'use client';

import React from 'react';
import { motion } from 'motion/react';
import { FileSearch, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';
import styles from '~/styles/deployment.module.css';

export const OCRLandingPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  const bullets = [
    'Excellent for handwritten text recognition',
    'Handles complex document layouts',
    'Good for low-quality scans',
    'Specialized AI models for documents',
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
          <FileSearch size={12} /> Optional
        </div>
        <h1 className={styles.heroTitle}>Landing.AI OCR</h1>
        <p className={styles.heroSub}>
          Specialized OCR for complex layouts and handwritten documents.
        </p>
      </motion.div>

      <Section title="Why Landing.AI?">
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
            <h3 style={h3Style}>Step 1: Create Landing.AI account</h3>
            <p style={pStyle}>
              Visit{' '}
              <a href="https://landing.ai" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                landing.ai <ExternalLink size={12} />
              </a>{' '}
              and sign up.
            </p>
          </div>
          <div>
            <h3 style={h3Style}>Step 2: Generate API key</h3>
            <p style={pStyle}>Navigate to API settings and generate a new key.</p>
          </div>
          <div>
            <h3 style={h3Style}>Step 3: Add to environment variables</h3>
            <CodeBlock
              code={`LANDING_AI_API_KEY=your_landing_ai_key_here`}
              onCopy={() => copyToClipboard('LANDING_AI_API_KEY=your_landing_ai_key_here', 'landing-env')}
              copied={copiedCode === 'landing-env'}
            />
          </div>
        </div>
      </Section>
    </>
  );
};

const h3Style: React.CSSProperties = { margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: 'var(--ink)' };
const pStyle: React.CSSProperties = { margin: '0 0 10px', color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 14 };
const linkStyle: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 };
