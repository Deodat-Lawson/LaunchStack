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
    'Multiple voices and languages out of the box',
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
          Text-to-speech via ElevenLabs. Audio ingestion transcription is handled
          automatically through the Groq Whisper route.
        </p>
      </motion.div>

      <Section title="What ElevenLabs adds">
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
            <h3 style={h3}>Step 1: Create ElevenLabs account</h3>
            <p style={p}>
              Visit{' '}
              <a href="https://elevenlabs.io" target="_blank" rel="noopener noreferrer" style={link}>
                elevenlabs.io <ExternalLink size={12} />
              </a>{' '}
              and create an account.
            </p>
          </div>
          <div>
            <h3 style={h3}>Step 2: Get API key</h3>
            <p style={p}>Profile → API Keys → generate a new key.</p>
          </div>
          <div>
            <h3 style={h3}>Step 3: Choose a voice</h3>
            <p style={p}>Browse the Voice Lab and copy the Voice ID you want to use.</p>
          </div>
          <div>
            <h3 style={h3}>Step 4: Add to environment variables</h3>
            <CodeBlock
              code={`ELEVENLABS_API_KEY=sk_your_key_here
ELEVENLABS_VOICE_ID=your_chosen_voice_id`}
              onCopy={() =>
                copyToClipboard(
                  'ELEVENLABS_API_KEY=sk_your_key_here\nELEVENLABS_VOICE_ID=your_chosen_voice_id',
                  'elevenlabs-env',
                )
              }
              copied={copiedCode === 'elevenlabs-env'}
            />
          </div>
          <InfoBox title="Popular voice IDs" icon={<Mic size={18} />}>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Rachel (female, American)</li>
              <li>Adam (male, American)</li>
              <li>Antoni (male, British)</li>
              <li>Browse more in the ElevenLabs Voice Lab</li>
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
