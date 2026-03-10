'use client';

import React from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';

interface StepProps {
  number: number;
  title: string;
  code?: string;
  description?: string;
  onCopy: () => void;
  copied: boolean;
  darkMode: boolean;
}

export const Step: React.FC<StepProps> = ({ 
  number, 
  title, 
  code, 
  description, 
  onCopy, 
  copied, 
  darkMode 
}) => (
  <div className="relative">
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-full flex items-center justify-center text-white font-bold shadow-lg">
        {number}
      </div>
      <div className="flex-1">
        <h3 className={`text-xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'} mb-2`}>
          {title}
        </h3>
        {description && (
          <p className={`${darkMode ? 'text-gray-400' : 'text-gray-600'} mb-3`}>
            {description}
          </p>
        )}
        {code && (
          <div className="relative group">
            <pre className="bg-gray-900 text-gray-100 rounded-xl p-4 overflow-x-auto text-sm font-mono">
              <code>{code}</code>
            </pre>
            <button
              onClick={onCopy}
              className="absolute top-3 right-3 p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
            >
              {copied ? (
                <CheckCircle2 className="w-4 h-4 text-green-400" />
              ) : (
                <Copy className="w-4 h-4 text-gray-400" />
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  </div>
);

