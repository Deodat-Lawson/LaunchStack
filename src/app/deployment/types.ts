import React from 'react';
import {
  Zap,
  Eye,
  Search as SearchIcon,
  FileSearch,
  Mic,
  Upload,
  Layers,
} from 'lucide-react';

// --- Types ---
export type DeploymentSection =
  | 'main'
  | 'inngest'
  | 'langchain'
  | 'tavily'
  | 'uploadthing'
  | 'ocr'
  | 'ocr-azure'
  | 'ocr-landing'
  | 'ocr-datalab'
  | 'voice';

export interface SectionChild {
  id: DeploymentSection;
  title: string;
}

export interface SectionConfig {
  id: DeploymentSection;
  title: string;
  icon: React.ReactNode;
  badge: 'Core' | 'Optional';
  hasChildren?: boolean;
  children?: SectionChild[];
}

export interface DeploymentProps {
  darkMode: boolean;
  copyToClipboard: (code: string, id: string) => void;
  copiedCode: string | null;
}

// --- Section Configuration Data ---
export const SECTIONS: SectionConfig[] = [
  {
    id: 'main',
    title: 'Main Deployment',
    icon: React.createElement(Zap, { className: 'w-4 h-4' }),
    badge: 'Core',
  },
  {
    id: 'inngest',
    title: 'Inngest Background Jobs',
    icon: React.createElement(Layers, { className: 'w-4 h-4' }),
    badge: 'Optional',
  },
  {
    id: 'langchain',
    title: 'LangChain Tracing',
    icon: React.createElement(Eye, { className: 'w-4 h-4' }),
    badge: 'Optional',
  },
  {
    id: 'tavily',
    title: 'Tavily Search',
    icon: React.createElement(SearchIcon, { className: 'w-4 h-4' }),
    badge: 'Optional',
  },
  {
    id: 'uploadthing',
    title: 'UploadThing Storage',
    icon: React.createElement(Upload, { className: 'w-4 h-4' }),
    badge: 'Optional',
  },
  {
    id: 'ocr',
    title: 'OCR Services',
    icon: React.createElement(FileSearch, { className: 'w-4 h-4' }),
    badge: 'Optional',
    hasChildren: true,
    children: [
      { id: 'ocr-azure', title: 'Azure Document Intelligence' },
      { id: 'ocr-landing', title: 'Landing.AI' },
      { id: 'ocr-datalab', title: 'Datalab (Legacy)' },
    ],
  },
  {
    id: 'voice',
    title: 'Voice/Audio',
    icon: React.createElement(Mic, { className: 'w-4 h-4' }),
    badge: 'Optional',
  },
];

