'use client';

import React from 'react';
import { motion } from 'motion/react';
import { Upload, Check, ExternalLink } from 'lucide-react';
import type { DeploymentProps } from '../../types';
import { Section, CodeBlock, WarningBox } from '../ui';

export const UploadThingPage: React.FC<DeploymentProps> = ({ 
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
          <Upload className="w-4 h-4" />
          Optional Feature
        </div>

        <h1 className="text-4xl font-bold mb-4 bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">
          UploadThing Cloud Storage
        </h1>
        <p className={`text-lg ${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-6`}>
          Fast, reliable cloud file storage for document uploads.
        </p>
      </motion.div>

      <Section title="What is UploadThing?" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          UploadThing provides a simple, type-safe file upload solution that enables:
        </p>
        <ul className={`space-y-2 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Fast, reliable cloud file storage</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Automatic file type validation</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Drag-and-drop upload interface</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>CDN-backed file delivery</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
            <span>Type-safe file routing with Next.js</span>
          </li>
        </ul>
      </Section>

      <Section title="Cloud vs Database Storage" darkMode={darkMode}>
        <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-4`}>
          PDR AI supports two storage methods for uploaded documents:
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-purple-900/30 border border-purple-500/30' : 'bg-purple-50 border border-purple-200'}`}>
            <h4 className={`font-semibold mb-2 ${darkMode ? 'text-purple-300' : 'text-purple-700'}`}>
              Cloud Storage (UploadThing)
            </h4>
            <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <li>• Better performance for large files</li>
              <li>• CDN-backed delivery</li>
              <li>• Requires UploadThing account</li>
              <li>• Recommended for production</li>
            </ul>
          </div>
          <div className={`p-4 rounded-xl ${darkMode ? 'bg-slate-800/50 border border-slate-600/30' : 'bg-slate-50 border border-slate-200'}`}>
            <h4 className={`font-semibold mb-2 ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>
              Database Storage
            </h4>
            <ul className={`text-sm space-y-1 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
              <li>• No external service required</li>
              <li>• Files stored in PostgreSQL</li>
              <li>• Good for development/testing</li>
              <li>• Works offline</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section title="Setup Instructions" darkMode={darkMode}>
        <div className="space-y-6">
          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 1: Create UploadThing Account
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Visit <a href="https://uploadthing.com" target="_blank" rel="noopener noreferrer" className="text-purple-600 hover:underline inline-flex items-center gap-1">
                uploadthing.com <ExternalLink className="w-4 h-4" />
              </a> and sign up for a free account.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 2: Create a New App
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              In your UploadThing dashboard, create a new app and copy your API token.
            </p>
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 3: Add to Environment Variables
            </h3>
            <CodeBlock
              code={`UPLOADTHING_TOKEN=your_token_here`}
              onCopy={() => copyToClipboard('UPLOADTHING_TOKEN=your_token_here', 'uploadthing-env')}
              copied={copiedCode === 'uploadthing-env'}
              darkMode={darkMode}
            />
          </div>

          <div>
            <h3 className={`text-lg font-semibold mb-3 ${darkMode ? 'text-white' : 'text-gray-900'}`}>
              Step 4: Enable Cloud Storage
            </h3>
            <p className={`${darkMode ? 'text-gray-300' : 'text-gray-600'} mb-3`}>
              Once configured, you can toggle between Cloud and Database storage on the upload page. 
              The preference is saved per-company and persists across sessions.
            </p>
          </div>

          <WarningBox
            title="Note"
            description="Without UploadThing configured, PDR AI will use database storage which stores files directly in PostgreSQL. This works well for development but cloud storage is recommended for production deployments."
            darkMode={darkMode}
          />
        </div>
      </Section>

      <Section title="File Limits" darkMode={darkMode}>
        <div className={`p-4 rounded-xl ${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
          <table className={`w-full text-sm ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
            <thead>
              <tr className={`border-b ${darkMode ? 'border-slate-600' : 'border-slate-200'}`}>
                <th className="text-left py-2 font-semibold">Limit</th>
                <th className="text-left py-2 font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              <tr className={`border-b ${darkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                <td className="py-2">Max file size</td>
                <td className="py-2">128 MB</td>
              </tr>
              <tr className={`border-b ${darkMode ? 'border-slate-700' : 'border-slate-100'}`}>
                <td className="py-2">Allowed file types</td>
                <td className="py-2">PDF only</td>
              </tr>
              <tr>
                <td className="py-2">Files per upload</td>
                <td className="py-2">1</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
};

