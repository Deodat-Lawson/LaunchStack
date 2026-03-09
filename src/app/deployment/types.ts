import React from 'react';
import {
  Zap,
  Eye,
  Search as SearchIcon,
  FileSearch,
  Mic,
  Upload,
  Database,
  Layers,
  Container,
  Rocket,
  Shield,
  BrainCircuit,
} from 'lucide-react';

// --- Types ---
export type DeploymentSection =
  | 'main'
  | 'docker'
  | 'vercel'
  | 'clerk'
  | 'inngest'
  | 'langchain'
  | 'tavily'
  | 'uploadthing'
  | 'vercel-blob'
  | 'ai-providers'
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
  group?: string;
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
    title: 'Overview',
    icon: React.createElement(Zap, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Get started',
  },
  {
    id: 'clerk',
    title: 'Clerk Authentication',
    icon: React.createElement(Shield, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Get started',
  },
  {
    id: 'vercel',
    title: 'Vercel',
    icon: React.createElement(Rocket, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Deployment',
  },
  {
    id: 'docker',
    title: 'Docker',
    icon: React.createElement(Container, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Deployment',
  },
  {
    id: 'vercel-blob',
    title: 'Vercel Blob',
    icon: React.createElement(Database, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Required',
  },
  {
    id: 'inngest',
    title: 'Inngest',
    icon: React.createElement(Layers, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Required',
  },
  {
    id: 'langchain',
    title: 'LangChain Tracing',
    icon: React.createElement(Eye, { className: 'w-4 h-4' }),
    badge: 'Optional',
    group: 'Optional',
  },
  {
    id: 'tavily',
    title: 'Tavily Search',
    icon: React.createElement(SearchIcon, { className: 'w-4 h-4' }),
    badge: 'Optional',
    group: 'Optional',
  },
  {
    id: 'uploadthing',
    title: 'UploadThing',
    icon: React.createElement(Upload, { className: 'w-4 h-4' }),
    badge: 'Optional',
    group: 'Optional',
  },
  {
    id: 'ai-providers',
    title: 'AI Model Providers',
    icon: React.createElement(BrainCircuit, { className: 'w-4 h-4' }),
    badge: 'Core',
    group: 'Required',
  },
  {
    id: 'ocr',
    title: 'OCR Services',
    icon: React.createElement(FileSearch, { className: 'w-4 h-4' }),
    badge: 'Optional',
    group: 'Optional',
    hasChildren: true,
    children: [
      { id: 'ocr-azure', title: 'Azure Document Intelligence' },
      { id: 'ocr-landing', title: 'Landing.AI' },
      { id: 'ocr-datalab', title: 'Datalab (Legacy)' },
    ],
  },
  {
    id: 'voice',
    title: 'Voice / Audio',
    icon: React.createElement(Mic, { className: 'w-4 h-4' }),
    badge: 'Optional',
    group: 'Optional',
  },
];
