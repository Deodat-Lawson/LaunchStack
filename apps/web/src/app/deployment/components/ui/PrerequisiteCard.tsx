'use client';

import React from 'react';
import { Check } from 'lucide-react';

interface PrerequisiteCardProps {
  icon: React.ReactNode;
  title: string;
  items: string[];
  darkMode: boolean;
}

export const PrerequisiteCard: React.FC<PrerequisiteCardProps> = ({ 
  icon, 
  title, 
  items, 
  darkMode 
}) => (
  <div className={`${darkMode ? 'bg-gray-800 border-gray-700' : 'bg-white border-gray-200'} rounded-xl p-6 border hover:border-purple-300 hover:shadow-lg transition-all duration-300`}>
    <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-lg flex items-center justify-center text-white mb-4">
      {icon}
    </div>
    <h3 className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'} mb-3`}>
      {title}
    </h3>
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li key={index} className={`flex items-start gap-2 text-sm ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          <Check className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

