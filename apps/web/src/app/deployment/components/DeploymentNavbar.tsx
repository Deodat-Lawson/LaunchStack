'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search as SearchIcon,
  Menu,
  X,
  Command,
  FileSearch,
  Home,
  Github,
  Moon,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import type { DeploymentSection, SectionConfig } from '../types';
import styles from '~/styles/deployment.module.css';

interface DeploymentNavbarProps {
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredSections: SectionConfig[];
  handleSelection: (id: DeploymentSection) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
}

export const DeploymentNavbar: React.FC<DeploymentNavbarProps> = ({
  searchQuery,
  setSearchQuery,
  filteredSections,
  handleSelection,
  mobileMenuOpen,
  setMobileMenuOpen,
}) => {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setSearchQuery('');
        searchInputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [setSearchQuery]);

  const showDropdown = isSearchFocused && searchQuery.length > 0;

  return (
    <nav className={styles.nav}>
      <Link href="/" className={styles.navBrand}>
        <span className={styles.brandMark} aria-hidden />
        <span className={styles.navBrandText}>
          <span className={styles.navBrandTitle}>Launchstack</span>
          <span className={styles.navBrandEyebrow}>Deploy</span>
        </span>
      </Link>

      <div className={styles.navSearch}>
        <SearchIcon className={styles.navSearchIcon} size={14} />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search deployment docs…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setTimeout(() => setIsSearchFocused(false), 180)}
          className={styles.navSearchInput}
        />
        {searchQuery ? (
          <button
            onClick={() => setSearchQuery('')}
            className={styles.navSearchKbd}
            aria-label="Clear search"
            type="button"
          >
            <X size={12} />
          </button>
        ) : (
          <span className={styles.navSearchKbd}>
            <Command size={10} />K
          </span>
        )}

        <AnimatePresence>
          {showDropdown && (
            <motion.div
              initial={{ opacity: 0, y: 6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className={styles.navDropdown}
            >
              {filteredSections.length > 0 ? (
                <>
                  <div className={styles.navDropdownLabel}>Results</div>
                  {filteredSections.map((section) => {
                    const q = searchQuery.toLowerCase();
                    const parentMatches = section.title.toLowerCase().includes(q);
                    const matchingChildren = section.children?.filter((child) =>
                      child.title.toLowerCase().includes(q),
                    );
                    return (
                      <React.Fragment key={section.id}>
                        <button
                          type="button"
                          onClick={() => handleSelection(section.id)}
                          className={styles.navDropdownItem}
                        >
                          <span className={styles.navDropdownIcon}>{section.icon}</span>
                          <span>
                            {section.title}
                            {!parentMatches && matchingChildren && matchingChildren.length > 0 && (
                              <> · {matchingChildren.length} matches</>
                            )}
                          </span>
                        </button>
                        {matchingChildren?.map((child) => (
                          <button
                            key={child.id}
                            type="button"
                            onClick={() => handleSelection(child.id)}
                            className={styles.navDropdownItem}
                            style={{ paddingLeft: 50 }}
                          >
                            <span>{child.title}</span>
                          </button>
                        ))}
                      </React.Fragment>
                    );
                  })}
                </>
              ) : (
                <div className={styles.navDropdownEmpty}>
                  <FileSearch size={24} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                  <div>No results for &ldquo;{searchQuery}&rdquo;</div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className={styles.navLinks}>
        <Link href="/" className={styles.navLink}>
          <Home size={14} />
          <span className={styles.navLinkLabel}>Home</span>
        </Link>
        <a
          href="https://github.com/Deodat-Lawson/pdr_ai_v2"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.navLink}
        >
          <Github size={14} />
          <span className={styles.navLinkLabel}>GitHub</span>
        </a>
        <ThemeToggleButton />
        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className={`${styles.navMobileBtn} ${mobileMenuOpen ? styles.navMobileBtnOpen : ''}`}
          aria-label="Toggle sidebar"
        >
          {mobileMenuOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>
    </nav>
  );
};

const ThemeToggleButton: React.FC = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isDark = mounted && resolvedTheme === 'dark';

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      className={styles.navThemeBtn}
      aria-label="Toggle theme"
    >
      {isDark ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
};
