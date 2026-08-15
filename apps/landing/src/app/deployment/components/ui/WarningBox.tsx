'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';
import styles from '~/styles/deployment.module.css';

interface WarningBoxProps {
  title: string;
  description: string;
}

export const WarningBox: React.FC<WarningBoxProps> = ({ title, description }) => (
  <div className={styles.calloutWarn}>
    <AlertCircle size={18} className={styles.calloutWarnIcon} style={{ marginTop: 2 }} />
    <div style={{ flex: 1 }}>
      <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
        {title}
      </h3>
      <p style={{ margin: 0, color: 'var(--ink-2)', lineHeight: 1.55, fontSize: 14 }}>
        {description}
      </p>
    </div>
  </div>
);
