'use client';

import React from 'react';
import { motion } from 'motion/react';
import { FileSearch, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';
import styles from '~/styles/deployment.module.css';

export const OCRAzurePage: React.FC<DeploymentProps> = ({ copyToClipboard, copiedCode }) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        style={{ marginBottom: 36 }}
      >
        <div className={styles.pill} style={{ marginBottom: 18 }}>
          <FileSearch size={12} />
          Optional
        </div>
        <h1 className={styles.heroTitle}>Azure Document Intelligence</h1>
        <p className={styles.heroSub}>
          Recommended OCR provider for standard documents, forms, and layouts.
        </p>
      </motion.div>

      <Section title="Why Azure Document Intelligence?">
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            'High accuracy for standard documents and forms',
            'Excellent layout preservation and table extraction',
            'Free tier available (F0)',
          ].map((item) => (
            <li key={item} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: 'var(--ink-2)', lineHeight: 1.55 }}>
              <Check size={16} className={styles.okIcon} style={{ marginTop: 3 }} />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Setup Instructions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div>
            <h3 style={stepTitleStyle}>Step 1: Create Azure Account</h3>
            <p style={bodyStyle}>
              Visit{' '}
              <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" style={linkStyle}>
                Azure Portal <ExternalLink size={12} />
              </a>{' '}
              and create an Azure account if you don&apos;t have one.
            </p>
          </div>

          <div>
            <h3 style={stepTitleStyle}>Step 2: Create Document Intelligence Resource</h3>
            <ol style={{ ...bodyStyle, paddingLeft: 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Search for &quot;Document Intelligence&quot; in Azure Portal</li>
              <li>Click &quot;Create&quot;</li>
              <li>Select subscription and resource group</li>
              <li>Choose a region and pricing tier (F0 free tier available)</li>
              <li>Review and create</li>
            </ol>
          </div>

          <div>
            <h3 style={stepTitleStyle}>Step 3: Get Keys and Endpoint</h3>
            <p style={bodyStyle}>
              After deployment, go to Keys and Endpoint section and copy:
            </p>
            <ul style={{ ...bodyStyle, paddingLeft: 22 }}>
              <li>Endpoint URL</li>
              <li>KEY 1 or KEY 2</li>
            </ul>
          </div>

          <div>
            <h3 style={stepTitleStyle}>Step 4: Add to Environment Variables</h3>
            <CodeBlock
              code={`AZURE_DOC_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOC_INTELLIGENCE_KEY=your_azure_key_here`}
              onCopy={() =>
                copyToClipboard(
                  'AZURE_DOC_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/\nAZURE_DOC_INTELLIGENCE_KEY=your_azure_key_here',
                  'azure-env',
                )
              }
              copied={copiedCode === 'azure-env'}
            />
          </div>
        </div>
      </Section>
    </>
  );
};

const stepTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--ink)',
};

const bodyStyle: React.CSSProperties = {
  margin: '0 0 10px',
  color: 'var(--ink-2)',
  lineHeight: 1.6,
  fontSize: 14,
};

const linkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};
