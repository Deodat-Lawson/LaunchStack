'use client';

import { useState, useCallback } from 'react';
import { useTheme } from 'next-themes';
import type { DeploymentSection } from '../types';
import { SECTIONS } from '../types';

export interface DeploymentState {
  // Theme
  darkMode: boolean;
  mounted: boolean;
  
  // Navigation
  activeSection: DeploymentSection;
  setActiveSection: (section: DeploymentSection) => void;
  expandedSections: string[];
  toggleSection: (sectionId: string) => void;
  
  // Mobile
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
  
  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredSections: typeof SECTIONS;
  
  // Clipboard
  copiedCode: string | null;
  copyToClipboard: (code: string, id: string) => void;
  
  // Helper
  handleSelection: (id: DeploymentSection) => void;
}

export function useDeploymentState(): DeploymentState {
  const [mounted, setMounted] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<DeploymentSection>('main');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<string[]>(['ocr']);

  // Use standard next-themes hook
  const { theme, resolvedTheme } = useTheme();
  const darkMode = mounted && (resolvedTheme === 'dark' || theme === 'dark');

  // Initialize mounted state
  useState(() => {
    setMounted(true);
  });

  const copyToClipboard = useCallback((code: string, id: string) => {
    void navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  }, []);

  const toggleSection = useCallback((sectionId: string) => {
    setExpandedSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(id => id !== sectionId)
        : [...prev, sectionId]
    );
  }, []);

  // Filter sections based on search query
  const filteredSections = SECTIONS.filter(section => {
    const titleMatch = section.title.toLowerCase().includes(searchQuery.toLowerCase());
    const childrenMatch = section.children?.some(child =>
      child.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return titleMatch || childrenMatch;
  });

  // Helper to handle navigation from search results
  const handleSelection = useCallback((id: DeploymentSection) => {
    setActiveSection(id);
    setSearchQuery(''); // Clear search
    setMobileMenuOpen(false); // Close mobile menu

    // Auto-expand OCR parent if a child is selected
    if (id.startsWith('ocr-') && !expandedSections.includes('ocr')) {
      setExpandedSections(prev => [...prev, 'ocr']);
    }
  }, [expandedSections]);

  return {
    darkMode,
    mounted,
    activeSection,
    setActiveSection,
    expandedSections,
    toggleSection,
    mobileMenuOpen,
    setMobileMenuOpen,
    searchQuery,
    setSearchQuery,
    filteredSections,
    copiedCode,
    copyToClipboard,
    handleSelection,
  };
}

