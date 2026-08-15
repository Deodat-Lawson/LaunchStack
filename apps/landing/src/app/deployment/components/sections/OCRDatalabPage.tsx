'use client';

import React from 'react';
import { motion } from 'motion/react';
import { FileSearch, AlertCircle } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, WarningBox, InfoBox } from '../ui';
import styles from '~/styles/deployment.module.css';

export const OCRDatalabPage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: 28 }}
      >
        <div className={styles.pill} style={{ marginBottom: 18 }}>
          <FileSearch size={12} /> Legacy
        </div>
        <h1 className={styles.heroTitle}>Datalab OCR (legacy)</h1>
        <p className={styles.heroSub}>
          Legacy OCR provider kept for reference. New installations should use Azure Document Intelligence or Landing.AI.
        </p>
      </motion.div>

      <div style={{ marginBottom: 32 }}>
        <WarningBox
          title="Legacy provider"
          description="Datalab is a legacy OCR integration. Consider Azure Document Intelligence or Landing.AI for better results and ongoing support."
        />
      </div>

      <Section title="Setup instructions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>
              Add to environment variables
            </h3>
            <CodeBlock
              code={`DATALAB_API_KEY=your_datalab_key_here`}
              onCopy={() => copyToClipboard('DATALAB_API_KEY=your_datalab_key_here', 'datalab-env')}
              copied={copiedCode === 'datalab-env'}
            />
          </div>
          <InfoBox title="Migration recommendation" icon={<AlertCircle size={18} />}>
            <p style={{ margin: '0 0 8px' }}>
              We recommend migrating to Azure Document Intelligence or Landing.AI for:
            </p>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>Better accuracy and reliability</li>
              <li>Active development and support</li>
              <li>More features and capabilities</li>
              <li>Better pricing and free tiers</li>
            </ul>
          </InfoBox>
        </div>
      </Section>
    </>
  );
};
