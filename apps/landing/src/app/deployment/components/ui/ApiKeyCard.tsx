'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';
import styles from '~/styles/deployment.module.css';

interface ApiKeyCardProps {
  title: string;
  link: string;
  description: string;
  steps: string[];
}

export const ApiKeyCard: React.FC<ApiKeyCardProps> = ({ title, link, description, steps }) => (
  <div className={`${styles.panel} ${styles.panelHover}`}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>
          {title}
        </h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5 }}>
          {description}
        </p>
      </div>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: 'var(--accent)',
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'flex-start',
        }}
        aria-label={`Open ${title}`}
      >
        <ExternalLink size={16} />
      </a>
    </div>
    <ol
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {steps.map((step, index) => (
        <li
          key={index}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            fontSize: 13.5,
            color: 'var(--ink-2)',
            lineHeight: 1.55,
          }}
        >
          <span
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              borderRadius: '50%',
              background: 'var(--accent-soft)',
              color: 'var(--accent-ink)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  </div>
);
