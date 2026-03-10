'use client';

import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight, Sparkles, Check, Circle } from 'lucide-react';
import type { DeploymentSection, SectionConfig } from '../types';
import { SECTIONS } from '../types';

interface DeploymentSidebarProps {
  darkMode: boolean;
  activeSection: DeploymentSection;
  setActiveSection: (section: DeploymentSection) => void;
  expandedSections: string[];
  toggleSection: (sectionId: string) => void;
  // Mobile props
  isMobile?: boolean;
  mobileMenuOpen?: boolean;
  searchQuery?: string;
  filteredSections?: SectionConfig[];
  handleSelection?: (id: DeploymentSection) => void;
}

export const DeploymentSidebar: React.FC<DeploymentSidebarProps> = ({
  darkMode,
  activeSection,
  setActiveSection,
  expandedSections,
  toggleSection,
  isMobile = false,
  mobileMenuOpen = false,
  searchQuery = '',
  filteredSections,
  handleSelection,
}) => {
  const sections = searchQuery && filteredSections ? filteredSections : SECTIONS;
  const onSelect = handleSelection ?? setActiveSection;

  const renderSection = (section: SectionConfig, index: number) => {
    const isActive = activeSection === section.id && !section.hasChildren;
    const isExpanded = expandedSections.includes(section.id);
    const hasActiveChild = section.children?.some(child => activeSection === child.id);

    return (
      <div key={section.id} className="relative">
        {/* Connection line for timeline effect */}
        {index < sections.length - 1 && (
          <div
            className={`absolute left-[23px] top-12 bottom-0 w-px ${
              darkMode ? 'bg-gray-800' : 'bg-gray-200'
            }`}
          />
        )}

        {/* Parent Section */}
        <motion.button
          whileHover={{ x: 2 }}
          whileTap={{ scale: 0.98 }}
          onClick={() => {
            if (section.hasChildren) {
              toggleSection(section.id);
            } else {
              onSelect(section.id);
            }
          }}
          className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all relative ${
            isActive
              ? 'bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 text-purple-400'
              : hasActiveChild
              ? darkMode
                ? 'text-gray-200'
                : 'text-gray-800'
              : darkMode
              ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/50'
          }`}
        >
          {/* Icon container with status indicator */}
          <div className="relative flex-shrink-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                isActive
                  ? 'bg-gradient-to-br from-violet-500 via-purple-500 to-fuchsia-500 text-white shadow-lg shadow-purple-500/25'
                  : hasActiveChild
                  ? darkMode
                    ? 'bg-purple-500/20 text-purple-400'
                    : 'bg-purple-100 text-purple-600'
                  : darkMode
                  ? 'bg-gray-800 text-gray-500'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {section.icon}
            </div>
            {/* Status dot */}
            {section.badge === 'Core' && (
              <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 ${darkMode ? 'border-gray-900' : 'border-white'}`} />
            )}
          </div>

          {/* Title and badge */}
          <div className="flex-1 text-left">
            <div className="flex items-center gap-2">
              <span className={isActive ? 'font-semibold' : ''}>{section.title}</span>
            </div>
            {section.badge && (
              <span
                className={`text-[10px] font-medium ${
                  section.badge === 'Core'
                    ? 'text-emerald-400'
                    : darkMode
                    ? 'text-gray-500'
                    : 'text-gray-400'
                }`}
              >
                {section.badge === 'Core' ? 'Required' : 'Optional'}
              </span>
            )}
          </div>

          {/* Expand indicator for sections with children */}
          {section.hasChildren && (
            <ChevronRight
              className={`w-4 h-4 transition-transform duration-200 ${
                isExpanded ? 'rotate-90' : ''
              } ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}
            />
          )}

          {/* Active indicator */}
          {isActive && (
            <motion.div
              layoutId={isMobile ? 'mobileActiveIndicator' : 'activeIndicator'}
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-gradient-to-b from-violet-500 via-purple-500 to-fuchsia-500 rounded-full"
            />
          )}
        </motion.button>

        {/* Child Sections */}
        {section.hasChildren && isExpanded && (
          <div className="ml-6 mt-1 space-y-0.5 relative">
            {/* Vertical line */}
            <div
              className={`absolute left-[11px] top-0 bottom-2 w-px ${
                darkMode ? 'bg-gray-800' : 'bg-gray-200'
              }`}
            />

            {section.children?.map((child) => {
              const isChildActive = activeSection === child.id;

              return (
                <button
                  key={child.id}
                  onClick={() => onSelect(child.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-colors relative hover:translate-x-0.5 ${
                    isChildActive
                      ? 'bg-gradient-to-r from-violet-500/10 via-purple-500/10 to-fuchsia-500/10 text-purple-400 font-medium'
                      : darkMode
                      ? 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100/50'
                  }`}
                >
                  {/* Connector dot */}
                  <div className="relative">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${
                        isChildActive
                          ? 'bg-purple-500 text-white'
                          : darkMode
                          ? 'bg-gray-800 border border-gray-700'
                          : 'bg-gray-100 border border-gray-200'
                      }`}
                    >
                      {isChildActive ? (
                        <Check className="w-3 h-3" />
                      ) : (
                        <Circle className="w-2 h-2" />
                      )}
                    </div>
                  </div>

                  <span>{child.title}</span>

                  {isChildActive && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-gradient-to-b from-violet-500 to-purple-500 rounded-full"
                    />
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const SidebarContent = () => (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 mb-2">
        <Sparkles className={`w-4 h-4 ${darkMode ? 'text-purple-400' : 'text-purple-500'}`} />
        <span className={`text-xs font-semibold uppercase tracking-wider ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {isMobile && searchQuery ? `Results (${filteredSections?.length ?? 0})` : 'Navigation'}
        </span>
      </div>

      {/* Sections */}
      <nav className="space-y-1">
        {sections.map((section, index) => renderSection(section, index))}
      </nav>

      {/* Footer Legend */}
      <div className={`mt-8 pt-4 border-t ${darkMode ? 'border-gray-800' : 'border-gray-200'}`}>
        <div className={`px-3 py-2 rounded-xl ${darkMode ? 'bg-gray-900/50' : 'bg-gray-50'}`}>
          <div className={`text-xs font-medium mb-2 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
            Legend
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>Required</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <div className={`w-2 h-2 rounded-full ${darkMode ? 'bg-gray-600' : 'bg-gray-300'}`} />
              <span className={darkMode ? 'text-gray-500' : 'text-gray-500'}>Optional</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Mobile Sidebar
  if (isMobile) {
    return (
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed left-0 top-16 bottom-0 w-72 ${
              darkMode
                ? 'bg-gray-950 border-gray-800'
                : 'bg-white border-gray-200'
            } border-r z-50 overflow-y-auto lg:pointer-events-none lg:opacity-0`}
          >
            <SidebarContent />
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  // Desktop Sidebar - always visible on lg screens
  return (
    <aside
      className={`w-72 fixed left-0 top-16 bottom-0 border-r ${
        darkMode
          ? 'border-gray-800/50 bg-gray-950/95'
          : 'border-gray-200/50 bg-white/95'
      } backdrop-blur-xl overflow-y-auto`}
      style={{
        display: 'block',
      }}
    >
      <SidebarContent />
    </aside>
  );
};
