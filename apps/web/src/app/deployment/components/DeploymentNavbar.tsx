'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import {
  Search as SearchIcon,
  Menu,
  X,
  Command,
  ArrowRight,
  FileSearch,
  Home,
  Github,
  ExternalLink,
} from 'lucide-react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import type { DeploymentSection, SectionConfig } from '../types';
import { LaunchstackMark } from '~/app/_components/LaunchstackLogo';

interface DeploymentNavbarProps {
  darkMode: boolean;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredSections: SectionConfig[];
  handleSelection: (id: DeploymentSection) => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: (open: boolean) => void;
}

export const DeploymentNavbar: React.FC<DeploymentNavbarProps> = ({
  darkMode,
  searchQuery,
  setSearchQuery,
  filteredSections,
  handleSelection,
  mobileMenuOpen,
  setMobileMenuOpen,
}) => {
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut for search (Cmd/Ctrl + K)
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
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 ${
          darkMode
            ? 'bg-gray-950/95 border-gray-800/50'
            : 'bg-white/95 border-gray-200/50'
        } backdrop-blur-xl border-b`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Main navbar row */}
          <div className="flex items-center justify-between h-16 gap-4">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-3 flex-shrink-0 group">
              <div className="relative">
                <LaunchstackMark size={36} title="Launchstack" />
                <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-emerald-400 rounded-full border-2 ${darkMode ? 'border-gray-950' : 'border-white'}`} />
              </div>
              <div className="flex flex-col">
                <span className="text-lg font-bold bg-gradient-to-r from-violet-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">
                  Launchstack
                </span>
                <span className={`text-[10px] font-medium ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                  Deployment Guide
                </span>
              </div>
            </Link>

            {/* Desktop: Search Bar */}
            <div className="flex-1 max-w-xl relative mx-4 lg:mx-8">
              <div
                className={`relative w-full transition-all duration-200 ${
                  isSearchFocused ? 'scale-[1.01]' : ''
                }`}
              >
                {/* Glow effect */}
                <div
                  className={`absolute inset-0 rounded-xl transition-opacity ${
                    isSearchFocused ? 'opacity-100' : 'opacity-0'
                  } bg-gradient-to-r from-violet-500/20 via-purple-500/20 to-fuchsia-500/20 blur-xl -z-10`}
                />
                <div className="relative">
                  <SearchIcon
                    className={`absolute left-3 md:left-4 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors ${
                      isSearchFocused
                        ? 'text-purple-400'
                        : darkMode
                        ? 'text-gray-500'
                        : 'text-gray-400'
                    }`}
                  />
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search docs..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => setTimeout(() => setIsSearchFocused(false), 200)}
                    className={`w-full pl-10 md:pl-11 pr-10 md:pr-20 py-2 md:py-2.5 rounded-xl text-sm transition-all ${
                      darkMode
                        ? 'bg-gray-900/80 border-gray-700/50 text-gray-100 placeholder-gray-500'
                        : 'bg-gray-50/80 border-gray-200 text-gray-900 placeholder-gray-400'
                    } border focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50`}
                  />
                  <div className="absolute right-2 md:right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
                    {searchQuery ? (
                      <button
                        onClick={() => setSearchQuery('')}
                        className={`p-1 rounded-md transition-colors ${
                          darkMode
                            ? 'hover:bg-gray-800 text-gray-400'
                            : 'hover:bg-gray-200 text-gray-500'
                        }`}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    ) : (
                      <kbd
                        className={`hidden md:flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium ${
                          darkMode
                            ? 'bg-gray-800 text-gray-400 border border-gray-700'
                            : 'bg-gray-100 text-gray-500 border border-gray-200'
                        }`}
                      >
                        <Command className="w-3 h-3" />
                        <span>K</span>
                      </kbd>
                    )}
                  </div>
                </div>
              </div>

              {/* Search Dropdown */}
              <AnimatePresence>
                {showDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    className={`absolute top-full left-0 right-0 mt-2 rounded-xl border shadow-2xl overflow-hidden z-50 ${
                      darkMode
                        ? 'bg-gray-900 border-gray-800 shadow-black/50'
                        : 'bg-white border-gray-200 shadow-gray-200/50'
                    }`}
                  >
                    {filteredSections.length > 0 ? (
                      <div className="p-2 max-h-80 overflow-y-auto">
                        <div className={`text-[10px] font-semibold uppercase tracking-wider px-3 py-2 ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                          Results
                        </div>
                        {filteredSections.map((section) => {
                          const parentMatches = section.title.toLowerCase().includes(searchQuery.toLowerCase());
                          const matchingChildren = section.children?.filter((child) =>
                            child.title.toLowerCase().includes(searchQuery.toLowerCase())
                          );

                          return (
                            <div key={section.id}>
                              <button
                                onClick={() => handleSelection(section.id)}
                                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all group ${
                                  darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                      parentMatches
                                        ? 'bg-purple-500/10 text-purple-400'
                                        : darkMode
                                        ? 'bg-gray-800 text-gray-500'
                                        : 'bg-gray-100 text-gray-400'
                                    }`}
                                  >
                                    {section.icon}
                                  </div>
                                  <div className="text-left">
                                    <div className={parentMatches ? (darkMode ? 'text-white' : 'text-gray-900') : (darkMode ? 'text-gray-400' : 'text-gray-500')}>
                                      {section.title}
                                    </div>
                                    {section.badge && (
                                      <span className={`text-[10px] ${section.badge === 'Core' ? 'text-emerald-400' : 'text-gray-500'}`}>
                                        {section.badge}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 text-purple-400 transition-opacity" />
                              </button>

                              {matchingChildren?.map((child) => (
                                <button
                                  key={child.id}
                                  onClick={() => handleSelection(child.id)}
                                  className={`w-full flex items-center justify-between px-3 py-2 pl-14 rounded-lg text-sm transition-all group ${
                                    darkMode ? 'hover:bg-gray-800' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <span className={darkMode ? 'text-gray-300' : 'text-gray-700'}>
                                    {child.title}
                                  </span>
                                  <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 text-purple-400 transition-opacity" />
                                </button>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className={`p-8 text-center ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                        <FileSearch className="w-10 h-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm font-medium">No results found</p>
                        <p className="text-xs mt-1 opacity-60">Try a different search term</p>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Right: Navigation Links */}
            <div className="flex items-center gap-1 md:gap-2 flex-shrink-0">
              <Link
                href="/"
                className={`flex items-center gap-2 px-2 md:px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  darkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-800'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Home className="w-4 h-4" />
                <span className="hidden md:inline">Home</span>
              </Link>
              <a
                href="https://github.com/Deodat-Lawson/pdr_ai_v2"
                target="_blank"
                rel="noopener noreferrer"
                className={`flex items-center gap-2 px-2 md:px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  darkMode
                    ? 'text-gray-400 hover:text-white hover:bg-gray-800'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                }`}
              >
                <Github className="w-4 h-4" />
                <span className="hidden md:inline">GitHub</span>
                <ExternalLink className="hidden md:block w-3 h-3 opacity-50" />
              </a>

              {/* Theme Toggle */}
              <ThemeToggleButton darkMode={darkMode} />

              {/* Mobile Menu Button */}
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className={`lg:hidden p-2 md:p-2.5 rounded-xl transition-colors ml-1 ${
                  mobileMenuOpen
                    ? 'bg-purple-500 text-white'
                    : darkMode
                    ? 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {mobileMenuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Backdrop for mobile menu */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setMobileMenuOpen(false)}
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            style={{ top: '64px' }}
          />
        )}
      </AnimatePresence>
    </>
  );
};

// Theme Toggle Button Component
const ThemeToggleButton: React.FC<{ darkMode: boolean }> = ({ darkMode }) => {
  const { setTheme } = useTheme();

  const toggleTheme = () => {
    setTheme(darkMode ? 'light' : 'dark');
  };

  return (
    <button
      onClick={toggleTheme}
      className={`p-2 rounded-lg transition-colors ${
        darkMode
          ? 'text-yellow-400 hover:bg-gray-800 hover:text-yellow-300'
          : 'text-purple-600 hover:bg-gray-100 hover:text-purple-700'
      }`}
      aria-label="Toggle theme"
    >
      {darkMode ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
};
