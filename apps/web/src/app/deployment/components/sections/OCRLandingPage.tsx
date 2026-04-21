'use client';

import React from 'react';
import { motion } from 'motion/react';
import { FileSearch, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';

export const OCRLandingPage: React.FC<DeploymentProps> = ({ 
  darkMode, 
  copyToClipboard, 
  copiedCode 
}) => {
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="mb-12"
      >
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-orange-900/50 text-orange-300' : 'bg-orange-100 text-orange-700'} rounded-full font-medium mb-6 text-sm`}>
          <FileSearch className="w-4 h-4" />
          Optional Feature
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Landing.AI OCR
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Specialized OCR for complex layouts and handwritten documents.
        </p>
      </motion.div>

      <Section title="Why Landing.AI?" darkMode={darkMode}>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Excellent for handwritten text recognition</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Handles complex document layouts</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Good for low-quality scans</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Specialized AI models for documents</span>
          </li>
        </ul>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create Landing.AI Account
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Visit <a href="https://landing.ai" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                landing.ai <ExternalLink className="w-4 h-4" />
              </a> and sign up.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Generate API Key
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Navigate to API settings and generate a new key.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Add to Environment Variables
            </h3>
            <CodeBlock
              code={`LANDING_AI_API_KEY=your_landing_ai_key_here`}
              onCopy={() => copyToClipboard('LANDING_AI_API_KEY=your_landing_ai_key_here', 'landing-env')}
              copied={copiedCode === 'landing-env'}
              darkMode={darkMode}
            />
          </div>
        </div>
      </Section>
    </>
  );
};

