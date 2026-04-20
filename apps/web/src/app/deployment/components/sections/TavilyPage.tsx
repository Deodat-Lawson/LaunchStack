'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Search as SearchIcon, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, WarningBox } from '../ui';

export const TavilyPage: React.FC<DeploymentProps> = ({ 
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
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-green-900/50 text-green-300' : 'bg-green-100 text-green-700'} rounded-full font-medium mb-6 text-sm`}>
          <SearchIcon className="w-4 h-4" />
          Optional Feature
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Tavily Search Integration
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Enhanced web search capabilities for document analysis and research.
        </p>
      </motion.div>

      <Section title="What is Tavily?" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          Tavily provides AI-optimized search API that enables:
        </p>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Real-time web search for document context</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Verify information from external sources</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Enrich AI responses with current data</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Research and fact-checking capabilities</span>
          </li>
        </ul>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create Tavily Account
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Visit <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                tavily.com <ExternalLink className="w-4 h-4" />
              </a> and sign up for an account.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Generate API Key
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Navigate to your dashboard and generate a new API key.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Add to Environment Variables
            </h3>
            <CodeBlock
              code={`TAVILY_API_KEY=tvly-your_key_here`}
              onCopy={() => copyToClipboard('TAVILY_API_KEY=tvly-your_key_here', 'tavily-env')}
              copied={copiedCode === 'tavily-env'}
              darkMode={darkMode}
            />
          </div>

          <WarningBox
            title="Note"
            description="Tavily search is used for enhanced document analysis. The app will work without it, but some advanced search features may be limited."
            darkMode={darkMode}
          />
        </div>
      </Section>
    </>
  );
};

