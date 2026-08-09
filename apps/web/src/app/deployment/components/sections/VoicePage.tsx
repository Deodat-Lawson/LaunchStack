'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Mic, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, InfoBox } from '../ui';
import styles from '~/styles/deployment.module.css';

export const VoicePage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  const bullets = [
    'Convert summaries and answers into audio',
    '30 prebuilt voices across roughly 90 languages',
    'Pairs with the voice-note ingestion pipeline',
    'Accessibility wins for visually-impaired users',
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
          <Mic size={12} /> Optional
        </div>
        <h1 className={styles.heroTitle}>Voice &amp; audio</h1>
        <p className={styles.heroSub}>
          Transcription runs on Gemini; speech generation on Google Cloud
          Text-to-Speech. Both use the same GOOGLE_AI_API_KEY as the rest of the
          deployment — no separate voice vendor, and no service account. The
          key&apos;s project needs the Cloud Text-to-Speech API enabled.
        </p>
      </motion.div>

      <Section title="What voice adds">
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
            <h3 style={h3}>Step 1: Get a Google AI Studio key</h3>
            <p style={p}>
              Visit{' '}
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={link}>
                aistudio.google.com/apikey <ExternalLink size={12} />
              </a>{' '}
              and create a key. The same key serves chat, transcription and speech.
            </p>
          </div>
          <div>
            <h3 style={h3}>Step 2: Add to environment variables</h3>
            <CodeBlock
              code={`GOOGLE_AI_API_KEY=<your-google-ai-key>
GEMINI_TTS_VOICE=en-US-Chirp3-HD-Kore`}
              onCopy={() =>
                copyToClipboard(
                  'GOOGLE_AI_API_KEY=<your-google-ai-key>\nGEMINI_TTS_VOICE=en-US-Chirp3-HD-Kore',
                  'gemini-voice-env',
                )
              }
              copied={copiedCode === 'gemini-voice-env'}
            />
          </div>
          <InfoBox title="Voices" icon={<Mic size={18} />}>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>en-US-Chirp3-HD-Kore — the default</li>
              <li>en-US-Chirp3-HD-Puck</li>
              <li>en-US-Chirp3-HD-Charon</li>
              <li>28 Chirp 3: HD voices across 50+ locales</li>
            </ul>
          </InfoBox>
        </div>
      </Section>
    </>
  );
};

const h3: React.CSSProperties = { margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: 'var(--ink)' };
const p: React.CSSProperties = { margin: '0 0 10px', color: 'var(--ink-2)', lineHeight: 1.6, fontSize: 14 };
const link: React.CSSProperties = { color: 'var(--accent)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 };
