'use client';

import React from 'react';
import { motion } from 'motion/react';

interface SectionProps {
  title: string;
  darkMode: boolean;
  children: React.ReactNode;
}

export const Section: React.FC<SectionProps> = ({ title, darkMode, children }) => (
  <motion.section
    initial={{ opacity: 0, y: 20 }}
    whileInView={{ opacity: 1, y: 0 }}
    viewport={{ once: true }}
    transition={{ duration: 0.6 }}
    className="mb-16"
  >
    <h2 className={`text-3xl font-bold mb-8 ${darkMode ? 'text-white' : 'text-gray-900'} flex items-center gap-3`}>
      <div className="w-2 h-8 bg-gradient-to-b from-purple-600 to-indigo-600 rounded-full"></div>
      {title}
    </h2>
    {children}
  </motion.section>
);

