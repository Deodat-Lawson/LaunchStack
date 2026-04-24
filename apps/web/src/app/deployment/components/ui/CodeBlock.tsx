'use client';

import React from 'react';
import { Copy, Check } from 'lucide-react';
import styles from '~/styles/deployment.module.css';

interface CodeBlockProps {
  code: string;
  onCopy: () => void;
  copied: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, onCopy, copied }) => (
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
);
