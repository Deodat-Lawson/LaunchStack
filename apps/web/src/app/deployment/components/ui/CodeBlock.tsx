'use client';

import React from 'react';
import { Copy, CheckCircle2 } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  onCopy: () => void;
  copied: boolean;
  darkMode: boolean;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ code, onCopy, copied }) => (
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
);

