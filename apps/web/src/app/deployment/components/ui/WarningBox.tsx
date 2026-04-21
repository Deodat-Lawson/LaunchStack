'use client';

import React from 'react';
import { AlertCircle } from 'lucide-react';

interface WarningBoxProps {
  title: string;
  description: string;
  darkMode: boolean;
}

export const WarningBox: React.FC<WarningBoxProps> = ({ title, description, darkMode }) => (
  <div className={`${darkMode ? 'bg-yellow-900/20 border-yellow-800' : 'bg-yellow-50 border-yellow-200'} border rounded-xl p-6`}>
    <div className="flex items-start gap-3">
      <AlertCircle className="w-6 h-6 text-yellow-600 flex-shrink-0" />
      <div>
        <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'} mb-2`}>
          {title}
        </h3>
        <p className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
          {description}
        </p>
      </div>
    </div>
  </div>
);

