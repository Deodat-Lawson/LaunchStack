'use client';

import React from 'react';
import { motion } from 'motion/react';
import { FileSearch, AlertCircle } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, WarningBox, InfoBox } from '../ui';

export const OCRDatalabPage: React.FC<DeploymentProps> = ({ 
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
          Optional Feature - Legacy
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          Datalab OCR (Legacy)
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Legacy OCR provider for basic text extraction.
        </p>
      </motion.div>

      <WarningBox
        title="Legacy Provider"
        description="Datalab is a legacy OCR provider. Consider using Azure Document Intelligence or Landing.AI for better results and continued support."
        darkMode={darkMode}
      />

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Add to Environment Variables
            </h3>
            <CodeBlock
              code={`DATALAB_API_KEY=your_datalab_key_here`}
              onCopy={() => copyToClipboard('DATALAB_API_KEY=your_datalab_key_here', 'datalab-env')}
              copied={copiedCode === 'datalab-env'}
              darkMode={darkMode}
            />
          </div>

          <InfoBox
            title="Migration Recommendation"
            icon={<AlertCircle className="w-6 h-6" />}
            darkMode={darkMode}
          >
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
              We recommend migrating to Azure Document Intelligence or Landing.AI for:
            </p>
            <ul className={`mt-2 space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
              <li>• Better accuracy and reliability</li>
              <li>• Active development and support</li>
              <li>• More features and capabilities</li>
              <li>• Better pricing and free tiers</li>
            </ul>
          </InfoBox>
        </div>
      </Section>
    </>
  );
};

