export interface Document {
  id: string;
  title: string;
  category: string;
  content?: string;
  pageCount: number;
  uploadDate: string;
  size?: string;
  pages?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface ChatHistory {
  id: string;
  title: string;
  date: string;
  messages: ChatMessage[];
  documentId?: string; // Optional: associates chat with a specific document
}

export interface PredictiveInsight {
  category: string;
  confidence: number;
  insights: string[];
}

export const mockDocuments: Document[] = [
  {
    id: '1',
    title: 'Lecture 14',
    category: 'test',
    content: 'Machine Learning EN.601.475/675 - Learning Graphs From Data',
    pageCount: 33,
    uploadDate: '2025-11-14'
  },
  {
    id: '2',
    title: '随任件',
    category: 'test',
    content: 'Chinese document content',
    pageCount: 12,
    uploadDate: '2025-11-12'
  },
  {
    id: '3',
    title: 'Lecture 12',
    category: 'test',
    content: 'Advanced Topics in Machine Learning',
    pageCount: 28,
    uploadDate: '2025-11-10'
  },
  {
    id: '4',
    title: 'Lecture 13',
    category: 'test',
    content: 'Neural Networks and Deep Learning',
    pageCount: 45,
    uploadDate: '2025-11-11'
  },
  {
    id: '5',
    title: 'Lecture 16',
    category: 'test',
    content: 'Reinforcement Learning Fundamentals',
    pageCount: 38,
    uploadDate: '2025-11-16'
  },
  {
    id: '6',
    title: 'Johns Chapter 6',
    category: 'Culture of Engineering Profession',
    content: 'Engineering Ethics and Professional Responsibility',
    pageCount: 52,
    uploadDate: '2025-10-28'
  },
  {
    id: '7',
    title: 'Autonomous cars',
    category: 'Culture of Engineering Profession',
    content: 'Ethical considerations in autonomous vehicle design',
    pageCount: 24,
    uploadDate: '2025-11-16'
  },
  {
    id: '8',
    title: 'Portfolio Analysis Q3',
    category: 'Investment science',
    content: 'Market trends and investment strategies for Q3 2025',
    pageCount: 19,
    uploadDate: '2025-09-30'
  }
];

export const mockChatHistory: ChatHistory[] = [
  {
    id: '1',
    title: 'Chat about Johns Chapter 6',
    date: '11/16/2025',
    documentId: '6', // Johns Chapter 6
    messages: [
      {
        id: '1',
        role: 'user',
        content: 'What are the main ethical principles discussed in this chapter?',
        timestamp: new Date('2025-11-16T10:30:00')
      },
      {
        id: '2',
        role: 'assistant',
        content: 'The chapter discusses several key ethical principles including professional responsibility, public safety, and the importance of transparency in engineering decisions.',
        timestamp: new Date('2025-11-16T10:30:15')
      }
    ]
  },
  {
    id: '2',
    title: 'Chat about Autonomous cars',
    date: '11/16/2025',
    documentId: '7', // Autonomous cars
    messages: []
  },
  {
    id: '3',
    title: 'Chat about Lecture 16',
    date: '11/12/2025',
    documentId: '5', // Lecture 16
    messages: []
  },
  {
    id: '4',
    title: 'Ethics in Practice',
    date: '11/12/2025',
    documentId: '6', // Johns Chapter 6
    messages: []
  },
  {
    id: '5',
    title: 'General AI Chat',
    date: '11/12/2025',
    documentId: undefined, // General chat, not tied to any document
    messages: []
  },
  {
    id: '6',
    title: 'Graph Learning Questions',
    date: '11/12/2025',
    documentId: '1', // Lecture 14
    messages: []
  },
  {
    id: '7',
    title: 'Data Structures Discussion',
    date: '11/12/2025',
    documentId: '1', // Lecture 14
    messages: []
  },
  {
    id: '8',
    title: 'Chat about 随任件',
    date: '11/12/2025',
    documentId: '2', // 随任件
    messages: []
  },
  {
    id: '9',
    title: 'Neural Networks Deep Dive',
    date: '11/11/2025',
    documentId: '4', // Lecture 13
    messages: []
  },
  {
    id: '10',
    title: 'Investment Strategy Review',
    date: '09/30/2025',
    documentId: '8', // Portfolio Analysis Q3
    messages: []
  }
];

export const generatePredictiveInsights = (doc: Document): PredictiveInsight[] => {
  const insights: PredictiveInsight[] = [
    {
      category: 'Document Classification',
      confidence: 0.92,
      insights: [
        `This document is classified as "${doc.category}" with 92% confidence`,
        'Primary topics include technical concepts and theoretical frameworks'
      ]
    },
    {
      category: 'Key Themes',
      confidence: 0.88,
      insights: [
        'Machine learning algorithms and data structures',
        'Mathematical foundations and theoretical proofs',
        'Practical applications and case studies'
      ]
    },
    {
      category: 'Complexity Analysis',
      confidence: 0.85,
      insights: [
        `Document length: ${doc.pageCount} pages - Medium complexity`,
        'Estimated reading time: ' + Math.round(doc.pageCount * 2.5) + ' minutes',
        'Technical difficulty: Advanced level'
      ]
    },
    {
      category: 'Related Documents',
      confidence: 0.79,
      insights: [
        'Similar to Lecture 12 and Lecture 13 (85% similarity)',
        'Recommended next reading: Lecture 16',
        'Prerequisites: Basic understanding of probability and statistics'
      ]
    }
  ];
  
  return insights;
};