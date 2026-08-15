'use client';

import React from 'react';
import { Check } from 'lucide-react';
import styles from '~/styles/deployment.module.css';

interface PrerequisiteCardProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
}

export const PrerequisiteCard: React.FC<PrerequisiteCardProps> = ({ icon, title, items }) => (
  <div className={`${styles.panel} ${styles.panelHover}`}>
    <div
      style={{
        width: 42,
        height: 42,
        borderRadius: 10,
        background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-deep) 100%)',
        color: 'white',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 14,
        boxShadow: '0 6px 16px var(--accent-glow)',
      }}
    >
      {icon}
    </div>
    <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>
      {title}
    </h3>
    <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {items.map((item, index) => (
        <li
          key={index}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            fontSize: 13,
            color: 'var(--ink-2)',
            lineHeight: 1.5,
          }}
        >
          <Check size={14} className={styles.okIcon} style={{ marginTop: 3 }} />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);
