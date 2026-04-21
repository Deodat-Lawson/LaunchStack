'use client';

import React from 'react';
import { motion } from 'motion/react';
import { FileSearch, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock } from '../ui';

export const OCRAzurePage: React.FC<DeploymentProps> = ({ 
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
          Azure Document Intelligence
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Recommended OCR provider for standard documents, forms, and layouts.
        </p>
      </motion.div>

      <Section title="Why Azure Document Intelligence?" darkMode={darkMode}>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>High accuracy for standard documents and forms</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Excellent layout preservation and table extraction</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Free tier available (F0)</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Enterprise-grade reliability</span>
          </li>
        </ul>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create Azure Account
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Visit <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                Azure Portal <ExternalLink className="w-4 h-4" />
              </a> and create an Azure account if you don&apos;t have one.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Create Document Intelligence Resource
            </h3>
            <ol className={`space-y-2 list-decimal list-inside ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <li>Search for &quot;Document Intelligence&quot; in Azure Portal</li>
              <li>Click &quot;Create&quot;</li>
              <li>Select subscription and resource group</li>
              <li>Choose a region and pricing tier (F0 free tier available)</li>
              <li>Review and create</li>
            </ol>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Get Keys and Endpoint
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              After deployment, go to Keys and Endpoint section and copy:
            </p>
            <ul className={`space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <li>• Endpoint URL</li>
              <li>• KEY 1 or KEY 2</li>
            </ul>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 4: Add to Environment Variables
            </h3>
            <CodeBlock
              code={`AZURE_DOC_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/
AZURE_DOC_INTELLIGENCE_KEY=your_azure_key_here`}
              onCopy={() => copyToClipboard('AZURE_DOC_INTELLIGENCE_ENDPOINT=https://your-resource.cognitiveservices.azure.com/\nAZURE_DOC_INTELLIGENCE_KEY=your_azure_key_here', 'azure-env')}
              copied={copiedCode === 'azure-env'}
              darkMode={darkMode}
            />
          </div>
        </div>
      </Section>
    </>
  );
};

