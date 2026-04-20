'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Eye, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';

export const LangChainPage: React.FC<DeploymentProps> = ({ 
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
        <div className={`inline-flex items-center gap-2 px-4 py-2 ${darkMode ? 'bg-blue-900/50 text-blue-300' : 'bg-blue-100 text-blue-700'} rounded-full font-medium mb-6 text-sm`}>
          <Eye className="w-4 h-4" />
          Optional Feature
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          LangChain Tracing Integration
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Monitor and debug your AI operations with LangSmith tracing.
        </p>
      </motion.div>

      <Section title="What is LangChain Tracing?" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          LangSmith provides observability for LangChain applications, allowing you to:
        </p>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Trace AI model calls and see exactly what&apos;s happening</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Debug complex chains and agent behaviors</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Monitor performance and token usage</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Analyze prompt effectiveness</span>
          </li>
        </ul>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create LangSmith Account
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Visit <a href="https://smith.langchain.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                smith.langchain.com <ExternalLink className="w-4 h-4" />
              </a> and create an account.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Get API Key
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Navigate to Settings → API Keys and generate a new key.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Add to Environment Variables
            </h3>
            <CodeBlock
              code={`LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_your_key_here
LANGCHAIN_PROJECT=pdr-ai`}
              onCopy={() => copyToClipboard('LANGCHAIN_TRACING_V2=true\nLANGCHAIN_API_KEY=lsv2_pt_your_key_here', 'langchain-env')}
              copied={copiedCode === 'langchain-env'}
              darkMode={darkMode}
            />
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 4: View Traces
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              Once configured, all LangChain operations will be automatically traced. View them at <a href="https://smith.langchain.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline">smith.langchain.com</a>
            </p>
          </div>
        </div>
      </Section>
    </>
  );
};

