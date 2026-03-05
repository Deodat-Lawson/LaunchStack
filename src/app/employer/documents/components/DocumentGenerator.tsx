"use client";

import { useState, useEffect, useCallback } from 'react';
import { DocumentGeneratorHome } from './DocumentGeneratorHome';
import { DocumentGeneratorConfig, type DocumentConfig } from './DocumentGeneratorConfig';
import { DocumentGeneratorEditor } from './DocumentGeneratorEditor';
import { Loader2 } from 'lucide-react';
import type { Citation } from './generator';

interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  preview: string;
}

interface GeneratedDocument {
  id: string;
  title: string;
  template: string;
  lastEdited: string;
  content: string;
  citations?: Citation[];
  metadata?: {
    tone?: string;
    audience?: string;
    length?: string;
    description?: string;
  };
}

interface APIDocument {
  id: number;
  title: string;
  content: string;
  templateId?: string;
  metadata?: GeneratedDocument['metadata'];
  citations?: Citation[];
  createdAt: string;
  updatedAt?: string;
}

export function DocumentGenerator() {
  const [currentView, setCurrentView] = useState<'home' | 'config' | 'editor'>('home');
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [currentDocument, setCurrentDocument] = useState<GeneratedDocument | null>(null);
  const [generatedDocuments, setGeneratedDocuments] = useState<GeneratedDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch documents from API on mount
  const fetchDocuments = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/document-generator/documents');
      const data = await response.json() as { success: boolean; message?: string; documents?: APIDocument[] };
      
      if (data.success && data.documents) {
        const docs: GeneratedDocument[] = data.documents
          .filter((doc: APIDocument) => doc.templateId !== 'rewrite')
          .map((doc: APIDocument) => ({
            id: doc.id.toString(),
            title: doc.title,
            template: doc.templateId ?? 'Custom',
            lastEdited: formatRelativeTime(doc.updatedAt ?? doc.createdAt),
            content: doc.content,
            citations: doc.citations,
            metadata: doc.metadata,
          }));
        setGeneratedDocuments(docs);
      } else {
        setError(data.message ?? 'Failed to fetch documents');
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError('Failed to load documents');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  // Format relative time
  const formatRelativeTime = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
    return date.toLocaleDateString();
  };

  const handleNewDocument = (template: DocumentTemplate) => {
    setSelectedTemplate(template);
    setCurrentView('config');
  };

  const handleGenerateWithConfig = async (config: DocumentConfig) => {
    if (!selectedTemplate) return;

    setIsSaving(true);
    setError(null);
    
    try {
      // Call the initialize API to generate content with AI + research
      const initResponse = await fetch('/api/document-generator/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          title: config.title,
          description: config.description,
          keywords: config.keywords,
          options: {
            tone: config.tone,
            length: config.length,
            audience: config.audience,
            includeResearch: config.includeResearch,
            arxivCategory: config.arxivCategory,
          },
        }),
      });

      const initData = await initResponse.json() as { success: boolean; message?: string; content?: string; citations?: Citation[] };
      
      if (!initData.success) {
        setError(initData.message ?? 'Failed to generate document content');
        setIsSaving(false);
        return;
      }

      const generatedContent = initData.content ?? '';
      const citations = initData.citations ?? [];
      
      // Create document in database
      const response = await fetch('/api/document-generator/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: config.title,
          content: generatedContent,
          templateId: selectedTemplate.id,
          citations,
          metadata: {
            tone: config.tone,
            audience: config.audience,
            length: config.length,
            description: config.description,
            keywords: config.keywords,
            includeResearch: config.includeResearch,
          },
        }),
      });

      const data = await response.json() as { success: boolean; message?: string; document?: { id: number } };
      
      if (data.success && data.document) {
        const newDoc: GeneratedDocument = {
          id: data.document.id.toString(),
          title: config.title,
          template: selectedTemplate.name,
          lastEdited: 'Just now',
          content: generatedContent,
          citations,
          metadata: {
            tone: config.tone,
            audience: config.audience,
            length: config.length,
            description: config.description,
          },
        };
        
        setCurrentDocument(newDoc);
        setGeneratedDocuments(prev => [newDoc, ...prev]);
        setCurrentView('editor');
      } else {
        setError(data.message ?? 'Failed to create document');
      }
    } catch (err) {
      console.error('Error creating document:', err);
      setError('Failed to create document');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenDocument = (document: GeneratedDocument) => {
    setCurrentDocument(document);
    setCurrentView('editor');
  };

  const handleSaveDocument = async (title: string, content: string, citations?: Citation[]) => {
    if (!currentDocument) return;

    try {
      const response = await fetch('/api/document-generator/documents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: parseInt(currentDocument.id),
          title,
          content,
          citations,
        }),
      });

      const data = await response.json() as { success: boolean };
      
      if (data.success) {
        const updatedDoc: GeneratedDocument = {
          ...currentDocument,
          title,
          content,
          citations,
          lastEdited: 'Just now',
        };

        setGeneratedDocuments(prev =>
          prev.map(doc => doc.id === currentDocument.id ? updatedDoc : doc)
        );
        setCurrentDocument(updatedDoc);
      }
    } catch (err) {
      console.error('Error saving document:', err);
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _handleDeleteDocument = async (documentId: string) => {
    try {
      const response = await fetch('/api/document-generator/documents', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: parseInt(documentId) }),
      });

      const data = await response.json() as { success: boolean };
      
      if (data.success) {
        setGeneratedDocuments(prev => prev.filter(doc => doc.id !== documentId));
      }
    } catch (err) {
      console.error('Error deleting document:', err);
    }
  };

  const handleBackToHome = () => {
    setCurrentView('home');
    setCurrentDocument(null);
    setSelectedTemplate(null);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _generateInitialContent = (template: DocumentTemplate): string => {
    const templates: Record<string, string> = {
      'blank': '',
      'research': `# Research Paper Title

## Abstract

Write your abstract here...

## Introduction

Provide background and context for your research...

## Literature Review

Review relevant previous research...

## Methodology

Describe your research methods...

## Results

Present your findings...

## Discussion

Analyze and interpret your results...

## Conclusion

Summarize your research and its implications...

## References

List your citations here...`,

      'report': `# Business Report

## Executive Summary

Provide a brief overview of the key findings and recommendations...

## Background

Describe the context and purpose of this report...

## Analysis

Present your detailed analysis...

### Key Findings

- Finding 1
- Finding 2
- Finding 3

## Recommendations

Based on the analysis, we recommend the following actions...

## Conclusion

Summarize the main points and next steps...`,

      'proposal': `# Project Proposal

## Project Overview

Describe the project and its objectives...

## Objectives

- Objective 1
- Objective 2
- Objective 3

## Scope of Work

Detail the specific tasks and deliverables...

## Timeline

Outline the project schedule and milestones...

## Budget

Provide cost estimates and resource requirements...

## Expected Outcomes

Describe the anticipated results and benefits...`,

      'technical': `# Technical Documentation

## Overview

Provide a high-level overview of the system or feature...

## System Architecture

Describe the technical architecture...

## Components

### Component 1
Description and specifications...

### Component 2
Description and specifications...

## API Reference

Document the available APIs and endpoints...

## Configuration

Explain configuration options and setup...

## Troubleshooting

Common issues and solutions...`,

      'meeting': `# Meeting Notes

**Date:** ${new Date().toLocaleDateString()}
**Time:** 
**Location:** 
**Attendees:** 

## Agenda

1. Item 1
2. Item 2
3. Item 3

## Discussion Points

### Topic 1
Key points discussed...

### Topic 2
Key points discussed...

## Decisions Made

- Decision 1
- Decision 2

## Action Items

- [ ] Action item 1 - Owner: [Name] - Due: [Date]
- [ ] Action item 2 - Owner: [Name] - Due: [Date]

## Next Steps

Outline the path forward...`,

      'whitepaper': `# Whitepaper Title

## Executive Summary

Provide a concise overview of the key points...

## The Challenge

Describe the problem or opportunity being addressed...

## The Solution

Present your solution or approach...

### Key Benefits

- Benefit 1
- Benefit 2
- Benefit 3

## How It Works

Explain the technical details or methodology...

## Case Studies

### Case Study 1
Real-world example and results...

## Implementation

Guide for adopting the solution...

## Conclusion

Summarize the value proposition...`,

      'case-study': `# Case Study

## Client Overview

**Company:** 
**Industry:** 
**Size:** 

## The Challenge

Describe the problem the client was facing...

## The Solution

Explain how you addressed the challenge...

## Implementation

Detail the process and timeline...

## Results

### Key Metrics

- Metric 1: [Result]
- Metric 2: [Result]
- Metric 3: [Result]

## Client Testimonial

"Quote from satisfied client..."

## Lessons Learned

Key takeaways from the project...`,

      'guide': `# How-To Guide

## Introduction

What readers will learn from this guide...

## Prerequisites

What you need before starting...

## Step 1: [First Step]

Detailed instructions for the first step...

## Step 2: [Second Step]

Detailed instructions for the second step...

## Step 3: [Third Step]

Detailed instructions for the third step...

## Tips and Best Practices

- Tip 1
- Tip 2
- Tip 3

## Troubleshooting

Common issues and how to resolve them...

## Conclusion

Summary and next steps...`,

      'policy': `# Policy Document

## Purpose

State the purpose of this policy...

## Scope

Define who this policy applies to...

## Policy Statement

Detail the policy requirements...

## Responsibilities

### Role 1
Specific responsibilities...

### Role 2
Specific responsibilities...

## Procedures

Step-by-step procedures for compliance...

## Compliance

How compliance will be monitored...

## Review and Updates

Schedule for policy review...`,

      'newsletter': `# Newsletter - ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}

## Editor's Note

Welcome message from the editor...

## Highlights This Month

- Highlight 1
- Highlight 2
- Highlight 3

## Featured Story

### [Story Title]

Full article content...

## Team Updates

News and updates from the team...

## Upcoming Events

- Event 1: [Date]
- Event 2: [Date]

## Resources

Helpful links and resources...`,

      'sop': `# Standard Operating Procedure

**SOP Number:** 
**Effective Date:** 
**Last Reviewed:** 

## Purpose

State the purpose of this SOP...

## Scope

Define what this procedure covers...

## Responsibilities

Who is responsible for each step...

## Procedure

### Step 1
Detailed instructions...

### Step 2
Detailed instructions...

### Step 3
Detailed instructions...

## Safety Considerations

Important safety notes...

## Quality Standards

Standards that must be met...

## Documentation Requirements

What records must be kept...

## References

Related documents and resources...`
    };

    return templates[template.id] ?? templates.blank ?? '';
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
          <p className="text-muted-foreground">Loading documents...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error && currentView === 'home') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <p className="text-red-500">{error}</p>
          <button 
            onClick={() => void fetchDocuments()}
            className="text-purple-600 hover:underline"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (currentView === 'editor' && currentDocument) {
    return (
      <div className="h-full">
        <DocumentGeneratorEditor
          initialTitle={currentDocument.title}
          initialContent={currentDocument.content}
          initialCitations={currentDocument.citations}
          documentId={parseInt(currentDocument.id)}
          onBack={handleBackToHome}
          onSave={handleSaveDocument}
        />
      </div>
    );
  }

  if (currentView === 'config' && selectedTemplate) {
    return (
      <div className="h-full">
        <DocumentGeneratorConfig
          template={selectedTemplate}
          onBack={handleBackToHome}
          onGenerate={(config) => void handleGenerateWithConfig(config)}
        />
      </div>
    );
  }

  return (
    <div className="h-full">
      <DocumentGeneratorHome
        onNewDocument={handleNewDocument}
        onOpenDocument={handleOpenDocument}
        generatedDocuments={generatedDocuments}
      />
    </div>
  );
}
