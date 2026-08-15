'use client';

import React from 'react';
import styles from '~/styles/deployment.module.css';

interface InfoBoxProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

export const InfoBox: React.FC<InfoBoxProps> = ({ title, icon, children }) => (
  <div className={styles.calloutInfo}>
    <div className={styles.calloutInfoIcon} style={{ marginTop: 2 }}>{icon}</div>
    <div style={{ flex: 1 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
        {title}
      </h3>
      <div style={{ color: 'var(--ink-2)', lineHeight: 1.55, fontSize: 14 }}>
        {children}
      </div>
    </div>
  </div>
);
