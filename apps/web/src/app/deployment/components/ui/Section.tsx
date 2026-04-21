'use client';

import React from 'react';
import { motion } from 'motion/react';

interface SectionProps {
  title: string;
  subtitle?: string;
  darkMode: boolean;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ title, subtitle, darkMode, children }) => (
  <motion.section
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.6 }}
    className="mb-16"
  >
    <h2 className={`text-3xl font-bold mb-2 ${darkMode ? 'text-white' : 'text-gray-900'} flex items-center gap-3`}>
      <div className="w-2 h-8 bg-gradient-to-b from-purple-600 to-indigo-600 rounded-full"></div>
      {title}
    </h2>
    {subtitle && (
      <p className={`ml-5 mb-8 ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>{subtitle}</p>
    )}
    {!subtitle && <div className="mb-8" />}
    {children}
  </motion.section>
);

