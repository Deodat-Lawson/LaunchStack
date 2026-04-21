'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';

interface ApiKeyCardProps {
  title: string;
  link: string;
  description: string;
  steps: string[];
  darkMode: boolean;
}

export const ApiKeyCard: React.FC<ApiKeyCardProps> = ({ 
  title, 
  link, 
  description, 
  steps, 
  darkMode 
}) => (
  <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-xl p-6 border hover:border-purple-300 hover:shadow-lg transition-all duration-300`}>
    <div className="flex items-start justify-between mb-4">
      <div>
        <h3 className={`text-xl font-semibold ${darkMode ? 'text-white' : 'text-gray-900'} mb-2`}>
          {title}
        </h3>
        <p className={`text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {description}
        </p>
      </div>
      <a
        href={link}
        target="_blank"
        rel="noopener noreferrer"
        className="text-purple-600 hover:text-purple-700 transition-colors"
      >
        <ExternalLink className="w-5 h-5" />
      </a>
    </div>
    <ol className="space-y-2">
      {steps.map((step, index) => (
        <li key={index} className={`flex items-start gap-3 ${darkMode ? 'text-gray-300' : 'text-gray-600'}`}>
          <span className="flex-shrink-0 w-6 h-6 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center text-sm font-semibold">
            {index + 1}
          </span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  </div>
);

