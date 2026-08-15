'use client';

import React from 'react';
import { motion } from 'motion/react';
import styles from '~/styles/deployment.module.css';

interface SectionProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ title, subtitle, children }) => (
  <motion.section
    initial={{ opacity: 0, y: 16 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true, margin: '-80px' }}
    transition={{ duration: 0.5 }}
    style={{ marginBottom: 56 }}
  >
    <h2 className={styles.sectionH2}>
      <span className={styles.sectionH2Bar} aria-hidden />
      {title}
    </h2>
    {subtitle ? (
      <p className={styles.sectionSub}>{subtitle}</p>
    ) : (
      <div style={{ height: 20 }} />
    )}
    {children}
  </motion.section>
);
