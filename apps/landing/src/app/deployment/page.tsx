'use client';

import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { DeploymentNavbar } from './components/DeploymentNavbar';
import { DeploymentSidebar } from './components/DeploymentSidebar';
import {
  MainDeployment,
  DockerDeploymentPage,
  VercelDeploymentPage,
  ClerkSetupPage,
  InngestPage,
  LangChainPage,
  ExaPage,
  UploadThingPage,
  VercelBlobPage,
  AIProvidersPage,
  OCRAzurePage,
  OCRLandingPage,
  OCRDatalabPage,
  VoicePage,
} from './components/sections';
import type { DeploymentSection } from './types';
import { SECTIONS } from './types';
import styles from '~/styles/deployment.module.css';

const VALID_SECTIONS = new Set<string>(
  SECTIONS.flatMap(s => [s.id, ...(s.children?.map(c => c.id) ?? [])])
);

function SectionFromParams({ onSection }: { onSection: (s: DeploymentSection) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const section = searchParams.get('section');
    if (section && VALID_SECTIONS.has(section)) {
      onSection(section as DeploymentSection);
    }
  }, [searchParams, onSection]);
  return null;
}

const DeploymentPage = () => {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<DeploymentSection>('main');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState<string[]>(['ocr']);

  const handleSectionFromParams = useCallback((section: DeploymentSection) => {
    setActiveSection(section);
    if (section.startsWith('ocr-')) {
      setExpandedSections(prev => prev.includes('ocr') ? prev : [...prev, 'ocr']);
    }
  }, []);

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

  const filteredSections = SECTIONS.filter(section => {
    const q = searchQuery.toLowerCase();
    const titleMatch = section.title.toLowerCase().includes(q);
    const childrenMatch = section.children?.some(child =>
      child.title.toLowerCase().includes(q)
    );
    return titleMatch || childrenMatch;
  });

  const handleSelection = (id: DeploymentSection) => {
    setActiveSection(id);
    setSearchQuery('');
    setMobileMenuOpen(false);
    if (id.startsWith('ocr-') && !expandedSections.includes('ocr')) {
      setExpandedSections(prev => [...prev, 'ocr']);
    }
  };

  const renderActiveSection = () => {
    const props = { copyToClipboard, copiedCode };

    switch (activeSection) {
      case 'main':
        return <MainDeployment {...props} />;
      case 'docker':
        return <DockerDeploymentPage {...props} />;
      case 'vercel':
        return <VercelDeploymentPage {...props} />;
      case 'clerk':
        return <ClerkSetupPage {...props} />;
      case 'inngest':
        return <InngestPage {...props} />;
      case 'langchain':
        return <LangChainPage {...props} />;
      case 'exa':
        return <ExaPage {...props} />;
      case 'uploadthing':
        return <UploadThingPage {...props} />;
      case 'vercel-blob':
        return <VercelBlobPage {...props} />;
      case 'ai-providers':
        return <AIProvidersPage {...props} />;
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
    <div className={styles.root}>
      <Suspense>
        <SectionFromParams onSection={handleSectionFromParams} />
      </Suspense>

      <DeploymentNavbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        filteredSections={filteredSections}
        handleSelection={handleSelection}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />

      <div className={styles.shell}>
        <DeploymentSidebar
          activeSection={activeSection}
          setActiveSection={handleSelection}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
        />
        <DeploymentSidebar
          activeSection={activeSection}
          setActiveSection={handleSelection}
          expandedSections={expandedSections}
          toggleSection={toggleSection}
          isMobile
          mobileMenuOpen={mobileMenuOpen}
          onBackdropClick={() => setMobileMenuOpen(false)}
        />
        <main className={styles.main}>
          <div className={styles.mainInner}>
            {renderActiveSection()}
          </div>
        </main>
      </div>
    </div>
  );
};

export default DeploymentPage;
