'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import type { DeploymentSection, SectionConfig } from '../types';
import { SECTIONS } from '../types';

interface DeploymentSidebarProps {
  darkMode: boolean;
  activeSection: DeploymentSection;
  setActiveSection: (section: DeploymentSection) => void;
  expandedSections: string[];
  toggleSection: (sectionId: string) => void;
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

  const grouped = useMemo(() => {
    const map = new Map<string, SectionConfig[]>();
    for (const s of sections) {
      const g = s.group ?? 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    return map;
  }, [sections]);

  const renderItem = (section: SectionConfig) => {
    const isActive = activeSection === section.id && !section.hasChildren;
    const isExpanded = expandedSections.includes(section.id);
    const hasActiveChild = section.children?.some(c => activeSection === c.id);

    return (
      <div key={section.id}>
        <button
          onClick={() => {
            if (section.hasChildren) {
              toggleSection(section.id);
            } else {
              onSelect(section.id);
            }
          }}
          className={`w-full flex items-center gap-2.5 pl-3 pr-2 py-2 rounded-lg text-[13px] transition-all relative group ${
            isActive
              ? darkMode
                ? 'bg-purple-500/10 text-purple-400 font-medium'
                : 'bg-purple-50 text-purple-700 font-medium'
              : hasActiveChild
              ? darkMode
                ? 'text-gray-200'
                : 'text-gray-800 font-medium'
              : darkMode
              ? 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
          }`}
        >
          {isActive && (
            <motion.div
              layoutId={isMobile ? 'mob-indicator' : 'desk-indicator'}
              className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-purple-500"
              transition={{ type: 'spring', stiffness: 350, damping: 30 }}
            />
          )}

          <span
            className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${
              isActive
                ? 'bg-purple-500 text-white'
                : hasActiveChild
                ? darkMode
                  ? 'bg-purple-500/20 text-purple-400'
                  : 'bg-purple-100 text-purple-600'
                : darkMode
                ? 'text-gray-500 group-hover:text-gray-400'
                : 'text-gray-400 group-hover:text-gray-600'
            }`}
          >
            {section.icon}
          </span>

          <span className="flex-1 text-left truncate">{section.title}</span>

          {section.hasChildren && (
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                isExpanded ? 'rotate-90' : ''
              } ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}
            />
          )}
        </button>

        {section.hasChildren && isExpanded && (
          <div className="ml-[22px] pl-3 mt-0.5 mb-1 border-l border-dashed border-gray-300 dark:border-gray-700">
            {section.children?.map(child => {
              const isChildActive = activeSection === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => onSelect(child.id)}
                  className={`w-full text-left pl-3 pr-2 py-1.5 rounded-md text-[13px] transition-colors ${
                    isChildActive
                      ? darkMode
                        ? 'text-purple-400 font-medium'
                        : 'text-purple-700 font-medium'
                      : darkMode
                      ? 'text-gray-500 hover:text-gray-300'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {child.title}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const SidebarContent = () => (
    <div className="px-3 py-5 space-y-6">
      {[...grouped.entries()].map(([group, items]) => (
        <div key={group}>
          <div
            className={`px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider ${
              darkMode ? 'text-gray-500' : 'text-gray-400'
            }`}
          >
            {group}
          </div>
          <nav className="space-y-0.5">
            {items.map(item => renderItem(item))}
          </nav>
        </div>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className={`fixed left-0 top-16 bottom-0 w-64 ${
              darkMode ? 'bg-gray-950 border-gray-800' : 'bg-white border-gray-200'
            } border-r z-50 overflow-y-auto lg:pointer-events-none lg:opacity-0`}
          >
            <SidebarContent />
          </motion.aside>
        )}
      </AnimatePresence>
    );
  }

  return (
    <aside
      className={`w-64 fixed left-0 top-16 bottom-0 border-r ${
        darkMode ? 'border-gray-800/50 bg-gray-950/95' : 'border-gray-200/50 bg-white/95'
      } backdrop-blur-xl overflow-y-auto`}
    >
      <SidebarContent />
    </aside>
  );
};
