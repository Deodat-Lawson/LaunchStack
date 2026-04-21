"use client";

import { useState } from 'react';
import { Search, Plus, FileText, Clock, Scale, Brain, Sparkles, ArrowRight } from 'lucide-react';
import { Input } from "~/app/employer/documents/components/ui/input";
import { Button } from "~/app/employer/documents/components/ui/button";
import { Card } from "~/app/employer/documents/components/ui/card";
import { cn } from "~/lib/utils";
import { Tabs, TabsList, TabsTrigger } from "~/app/employer/documents/components/ui/tabs";
import { TEMPLATE_REGISTRY, type TemplateField } from "@launchstack/features/legal-templates";

export interface DocumentTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  preview: string;
  isLegal?: boolean;
  fields?: TemplateField[];
}

interface GeneratedDocument {
  id: string;
  title: string;
  template: string;
  lastEdited: string;
  content: string;
}

interface DocumentGeneratorHomeProps {
  onNewDocument: (template: DocumentTemplate) => void;
  onOpenDocument: (document: GeneratedDocument) => void;
  onStartChat: (initialMessage?: string) => void;
  generatedDocuments: GeneratedDocument[];
}

const STAGE_MAP: Record<string, string> = {
  nda: 'Formation & Founders',
  founders_agreement: 'Formation & Founders',
  ip_assignment: 'Formation & Founders',
  service_agreement: 'Business Operations',
  contractor_agreement: 'Business Operations',
  safe: 'Fundraising',
  advisory_agreement: 'Fundraising',
  employment_contract: 'Hiring & Onboarding',
  employee_nda: 'Hiring & Onboarding',
  invention_assignment: 'Hiring & Onboarding',
  at_will_employment: 'Hiring & Onboarding',
  non_compete: 'Hiring & Onboarding',
  privacy_policy: 'Compliance',
  terms_of_service: 'Compliance',
  termination_letter: 'Offboarding',
  severance_agreement: 'Offboarding',
};

const templates: DocumentTemplate[] = Object.values(TEMPLATE_REGISTRY).map((t) => ({
  id: t.id,
  name: t.name,
  category: STAGE_MAP[t.id] ?? 'Legal',
  description: t.description,
  preview: '',
  isLegal: true,
  fields: t.fields,
}));

const STAGE_ORDER = [
  'Formation & Founders',
  'Business Operations',
  'Fundraising',
  'Hiring & Onboarding',
  'Compliance',
  'Offboarding',
];

export function DocumentGeneratorHome({ onNewDocument, onOpenDocument, onStartChat, generatedDocuments }: DocumentGeneratorHomeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'new' | 'existing'>('new');
  const [chatInput, setChatInput] = useState('');

  const categories = ['all', ...STAGE_ORDER];

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredDocuments = generatedDocuments.filter(doc =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const groupedTemplates = selectedCategory === 'all'
    ? STAGE_ORDER.map(stage => ({
        stage,
        items: filteredTemplates.filter(t => t.category === stage),
      })).filter(g => g.items.length > 0)
    : [{ stage: selectedCategory, items: filteredTemplates }];

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex-shrink-0 bg-background border-b border-border p-6">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20">
                  <Scale className="w-6 h-6 text-white" />
                </div>
                <h1 className="text-2xl font-bold text-foreground">Legal Document Generator</h1>
              </div>
              <p className="text-muted-foreground">
                Generate legal documents from professional templates
              </p>
            </div>
          </div>

          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as 'new' | 'existing')}>
            <TabsList className="bg-muted">
              <TabsTrigger value="new" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                <Plus className="w-4 h-4 mr-2" />
                New Document
              </TabsTrigger>
              <TabsTrigger value="existing" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                <Clock className="w-4 h-4 mr-2" />
                My Documents ({generatedDocuments.length})
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Search */}
      <div className="flex-shrink-0 bg-background border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder={viewMode === 'new' ? "Search legal templates..." : "Search your documents..."}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-background border-border"
            />
          </div>
        </div>
      </div>

      {/* Stage Filter */}
      {viewMode === 'new' && (
        <div className="flex-shrink-0 bg-background border-b border-border px-6 py-3">
          <div className="max-w-7xl mx-auto">
            <div className="flex gap-2 overflow-x-auto pb-2">
              {categories.map((category) => (
                <Button
                  key={category}
                  variant={selectedCategory === category ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(category)}
                  className={cn(
                    selectedCategory === category
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {category === 'all' ? 'All Templates' : category}
                </Button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto p-6">
          {viewMode === 'new' ? (
            <div className="space-y-8">
              {/* AI Assistant Banner */}
              <Card className="relative overflow-hidden border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    <div className="p-2.5 bg-blue-600 rounded-xl shadow-lg shadow-blue-500/20 shrink-0">
                      <Sparkles className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-foreground mb-1">
                        Not sure which template you need?
                      </h3>
                      <p className="text-sm text-muted-foreground mb-3">
                        Describe your situation and our AI assistant will recommend the right template and help you fill it out.
                      </p>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <input
                            type="text"
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && chatInput.trim()) {
                                onStartChat(chatInput.trim());
                              }
                            }}
                            placeholder="e.g. I need an NDA for new employees..."
                            className={cn(
                              "w-full rounded-lg border border-blue-200 dark:border-blue-700 bg-background px-3 py-2",
                              "text-sm text-foreground placeholder:text-muted-foreground",
                              "focus:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:border-ring"
                            )}
                          />
                        </div>
                        <Button
                          className="bg-blue-600 hover:bg-blue-700 text-white shrink-0"
                          size="sm"
                          onClick={() => onStartChat(chatInput.trim() || undefined)}
                        >
                          <Sparkles className="w-4 h-4 mr-1.5" />
                          Ask AI
                          <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>

              {groupedTemplates.map(({ stage, items }) => (
                <div key={stage}>
                  <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-lg font-semibold text-foreground">{stage}</h2>
                    <span className="text-xs px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full font-medium">
                      {items.length}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {items.map((template) => (
                      <Card
                        key={template.id}
                        className="group cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-2 border-border hover:border-blue-600 overflow-hidden flex flex-col bg-card"
                        onClick={() => onNewDocument(template)}
                      >
                        {/* Document Preview */}
                        <div className="bg-muted p-4 h-44 flex items-start justify-center relative overflow-hidden">
                          <div className="w-full h-full overflow-hidden">
                            <div className="bg-white dark:bg-gray-900 rounded shadow-lg border border-gray-200 dark:border-gray-700 relative p-3 h-full">
                              <div className="space-y-2 mb-3">
                                <div className="h-3 bg-gray-900 dark:bg-gray-100 rounded w-3/4" />
                                <div className="h-0.5 bg-gray-300 dark:bg-gray-600 rounded w-full" />
                              </div>
                              <div className="space-y-1.5">
                                <div className="h-2 bg-gray-400 dark:bg-gray-500 rounded w-1/3 mb-1" />
                                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
                                <div className="h-1.5 bg-amber-200 dark:bg-amber-800/40 rounded w-2/3" />
                                <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                                <div className="pt-1.5">
                                  <div className="h-2 bg-gray-400 dark:bg-gray-500 rounded w-2/5 mb-1" />
                                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded w-full" />
                                  <div className="h-1.5 bg-amber-200 dark:bg-amber-800/40 rounded w-4/5" />
                                  <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
                                </div>
                              </div>
                            </div>
                          </div>

                          <div className="absolute top-2 right-2">
                            <span className="text-[0.5rem] px-1.5 py-0.5 bg-blue-600 text-white rounded font-medium shadow-sm flex items-center gap-0.5">
                              <Scale className="w-2.5 h-2.5" />
                              DOCX
                            </span>
                          </div>
                          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-gray-200/50 dark:from-background/50 to-transparent" />
                        </div>

                        <div className="p-4 flex-1 flex flex-col">
                          <h3 className="font-semibold mb-2 text-foreground">{template.name}</h3>
                          <p className="text-sm text-muted-foreground line-clamp-2 flex-1">
                            {template.description}
                          </p>
                        </div>

                        <div className="px-4 pb-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button
                            size="sm"
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            <Scale className="w-4 h-4 mr-2" />
                            Generate Document
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div>
              {filteredDocuments.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredDocuments.map((doc) => (
                    <Card
                      key={doc.id}
                      className="group cursor-pointer hover:shadow-lg transition-all hover:scale-[1.02] border-2 border-border hover:border-blue-600 p-5 bg-card"
                      onClick={() => onOpenDocument(doc)}
                    >
                      <div className="flex items-start gap-3 mb-3">
                        <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded">
                          <FileText className="w-5 h-5 text-blue-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold truncate mb-1 text-foreground">{doc.title}</h3>
                          <p className="text-xs text-muted-foreground">
                            {doc.template} &middot; Last edited {doc.lastEdited}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-3 mb-3">
                        {doc.content.replace(/<[^>]*>/g, '').slice(0, 150)}...
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full group-hover:bg-blue-600 group-hover:text-white border-border"
                      >
                        Open Document
                      </Button>
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16">
                  <FileText className="w-16 h-16 text-muted-foreground/30 mb-4" />
                  <h3 className="text-xl font-semibold mb-2 text-foreground">No documents yet</h3>
                  <p className="text-muted-foreground mb-6">
                    Generate your first legal document to get started
                  </p>
                  <Button
                    onClick={() => setViewMode('new')}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Create New Document
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
