'use client';

import React from 'react';
import { Copy, Check } from 'lucide-react';
import styles from '~/styles/deployment.module.css';

interface StepProps {
  number: number;
  title: string;
  code?: string;
  description?: string;
  children?: React.ReactNode;
  onCopy: () => void;
  copied: boolean;
}

export const Step: React.FC<StepProps> = ({
  number,
  title,
  code,
  description,
  children,
  onCopy,
  copied,
}) => (
  <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
    <div className={styles.stepCircle}>{number}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <h3
        style={{
          margin: '2px 0 6px',
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: '-0.01em',
          color: 'var(--ink)',
        }}
      >
        {title}
      </h3>
      {description && (
        <p style={{ margin: '0 0 12px', color: 'var(--ink-2)', lineHeight: 1.55 }}>
          {description}
        </p>
      )}
      {children && (
        <div style={{ marginBottom: 12, color: 'var(--ink-2)', lineHeight: 1.55 }}>
          {children}
        </div>
      )}
      {code && (
        <pre className={styles.codeSurface}>
          <code>{code}</code>
          <button
            type="button"
            onClick={onCopy}
            className={`${styles.codeCopyBtn} ${copied ? styles.codeCopyOk : ''}`}
            aria-label={copied ? 'Copied' : 'Copy code'}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </pre>
      )}
    </div>
  </div>
);
