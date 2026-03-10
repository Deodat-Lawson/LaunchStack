'use client';

import React, { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { DeploymentNavbar } from './components/DeploymentNavbar';
import { DeploymentSidebar } from './components/DeploymentSidebar';
import {
  MainDeployment,
  InngestPage,
  LangChainPage,
  TavilyPage,
  UploadThingPage,
  OCRAzurePage,
  OCRLandingPage,
  OCRDatalabPage,
  VoicePage,
} from './components/sections';
import type { DeploymentSection } from './types';
import { SECTIONS } from './types';

const DeploymentPage = () => {
  const [mounted, setMounted] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<DeploymentSection>('main');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<string[]>(['ocr']);
  
  // Use standard next-themes hook
  const { theme, resolvedTheme } = useTheme();
  const darkMode = mounted && (resolvedTheme === 'dark' || theme === 'dark');

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div className="min-h-screen bg-white dark:bg-gray-900" />;
  }

  const copyToClipboard = (code: string, id: string) => {
    void navigator.clipboard.writeText(code);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev =>
      prev.includes(sectionId)
        ? prev.filter(id => id !== sectionId)
        : [...prev, sectionId]
    );
  };

  // Filter sections based on search query
  const filteredSections = SECTIONS.filter(section => {
    const titleMatch = section.title.toLowerCase().includes(searchQuery.toLowerCase());
    const childrenMatch = section.children?.some(child =>
      child.title.toLowerCase().includes(searchQuery.toLowerCase())
    );
    return titleMatch || childrenMatch;
  });

  // Helper to handle navigation from search results
  const handleSelection = (id: DeploymentSection) => {
    setActiveSection(id);
    setSearchQuery(''); // Clear search
    setMobileMenuOpen(false); // Close mobile menu
    
    // Auto-expand OCR parent if a child is selected
    if (id.startsWith('ocr-') && !expandedSections.includes('ocr')) {
      setExpandedSections(prev => [...prev, 'ocr']);
    }
  };

  // Render the active section content
  const renderActiveSection = () => {
    const props = { darkMode, copyToClipboard, copiedCode };

    switch (activeSection) {
      case 'main':
        return <MainDeployment {...props} />;
      case 'inngest':
        return <InngestPage {...props} />;
      case 'langchain':
        return <LangChainPage {...props} />;
      case 'tavily':
        return <TavilyPage {...props} />;
      case 'uploadthing':
        return <UploadThingPage {...props} />;
      case 'ocr':
      case 'ocr-azure':
        return <OCRAzurePage {...props} />;
      case 'ocr-landing':
        return <OCRLandingPage {...props} />;
      case 'ocr-datalab':
        return <OCRDatalabPage {...props} />;
      case 'voice':
        return <VoicePage {...props} />;
      default:
        return <MainDeployment {...props} />;
    }
  };

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900' : 'bg-gradient-to-br from-slate-50 via-white to-purple-50'}`}>
      {/* Top Navigation */}
      <DeploymentNavbar
        darkMode={darkMode}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filteredSections={filteredSections}
        handleSelection={handleSelection}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />

      <div className="pt-16 flex">
        {/* Desktop Sidebar - always visible */}
        <DeploymentSidebar
          darkMode={darkMode}
          activeSection={activeSection}
          setActiveSection={handleSelection}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
        />

        {/* Mobile Sidebar - shown when menu is open */}
        <DeploymentSidebar
          darkMode={darkMode}
          activeSection={activeSection}
          setActiveSection={handleSelection}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          isMobile={true}
          mobileMenuOpen={mobileMenuOpen}
          searchQuery={searchQuery}
          filteredSections={filteredSections}
          handleSelection={handleSelection}
        />

        {/* Main Content */}
        <main className="flex-1 ml-72">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            {renderActiveSection()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DeploymentPage;
