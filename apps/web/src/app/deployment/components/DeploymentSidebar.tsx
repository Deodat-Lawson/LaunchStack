'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import type { DeploymentSection, SectionConfig } from '../types';
import { SECTIONS, SIDEBAR_GROUP_ORDER } from '../types';
import styles from '~/styles/deployment.module.css';

interface DeploymentSidebarProps {
  activeSection: DeploymentSection;
  setActiveSection: (section: DeploymentSection) => void;
  expandedSections: string[];
  toggleSection: (sectionId: string) => void;
  isMobile?: boolean;
  mobileMenuOpen?: boolean;
  onBackdropClick?: () => void;
}

export const DeploymentSidebar: React.FC<DeploymentSidebarProps> = ({
  activeSection,
  setActiveSection,
  expandedSections,
  toggleSection,
  isMobile = false,
  mobileMenuOpen = false,
  onBackdropClick,
}) => {
  const grouped = useMemo(() => {
    const map = new Map<string, SectionConfig[]>();
    for (const s of SECTIONS) {
      const g = s.group ?? 'Other';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(s);
    }
    const order = [...SIDEBAR_GROUP_ORDER] as string[];
    return [...map.entries()].sort(
      ([a], [b]) => order.indexOf(a) - order.indexOf(b),
    );
  }, []);

  const renderItem = (section: SectionConfig) => {
    const isActive = activeSection === section.id && !section.hasChildren;
    const isExpanded = expandedSections.includes(section.id);
    const hasActiveChild = section.children?.some(c => activeSection === c.id);

    const itemClasses = [
      styles.sidebarItem,
      isActive ? styles.sidebarItemActive : '',
      hasActiveChild ? styles.sidebarItemParent : '',
    ].filter(Boolean).join(' ');

    return (
      <div key={section.id}>
        <button
          onClick={() => {
            if (section.hasChildren) {
              toggleSection(section.id);
            } else {
              setActiveSection(section.id);
            }
          }}
          className={itemClasses}
        >
          {isActive && (
            <motion.span
              layoutId={isMobile ? 'mob-indicator' : 'desk-indicator'}
              className={styles.sidebarActiveBar}
              transition={{ type: 'spring', stiffness: 360, damping: 30 }}
            />
          )}
          <span className={styles.sidebarItemIcon}>{section.icon}</span>
          <span className={styles.sidebarItemLabel}>{section.title}</span>
          {section.hasChildren && (
            <ChevronRight
              className={`${styles.sidebarChevron} ${isExpanded ? styles.sidebarChevronOpen : ''}`}
            />
          )}
        </button>

        {section.hasChildren && isExpanded && (
          <div className={styles.sidebarChildren}>
            {section.children?.map(child => {
              const isChildActive = activeSection === child.id;
              return (
                <button
                  key={child.id}
                  onClick={() => setActiveSection(child.id)}
                  className={`${styles.sidebarChild} ${isChildActive ? styles.sidebarChildActive : ''}`}
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

  const Body = (
    <div className={styles.sidebarInner}>
      {grouped.map(([group, items]) => (
        <div key={group} className={styles.sidebarGroup}>
          <div className={styles.sidebarGroupLabel}>{group}</div>
          <nav>
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
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onBackdropClick}
              className={styles.sidebarBackdrop}
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 26, stiffness: 220 }}
              className={`${styles.sidebar} ${styles.sidebarMobile} ${styles.sidebarOpen}`}
            >
              {Body}
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    );
  }

  return (
    <aside className={styles.sidebar}>
      {Body}
    </aside>
  );
};
