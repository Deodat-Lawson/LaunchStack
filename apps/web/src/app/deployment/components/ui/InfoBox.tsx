'use client';

import React from 'react';

interface InfoBoxProps {
  title: string;
  icon: React.ReactNode;
  darkMode: boolean;
  children: React.ReactNode;
}

export const InfoBox: React.FC<InfoBoxProps> = ({ title, icon, darkMode, children }) => (
  <div className={`${darkMode ? 'bg-blue-900/20 border-blue-800' : 'bg-blue-50 border-blue-200'} border rounded-xl p-6`}>
    <div className="flex items-center gap-3 mb-4">
      <div className="text-blue-600">{icon}</div>
      <h3 className={`text-lg font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>
        {title}
      </h3>
    </div>
    {children}
  </div>
);

