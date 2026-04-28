"use client";

import { useState } from 'react';
import {
  Search,
  Plus,
  FileText,
  Clock,
  Scale,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { TEMPLATE_REGISTRY, type TemplateField } from "@launchstack/features/legal-templates";
import { legalTheme as s } from './LegalGeneratorTheme';

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

export function DocumentGeneratorHome({
  onNewDocument,
  onOpenDocument,
  onStartChat,
  generatedDocuments,
}: DocumentGeneratorHomeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'new' | 'existing'>('new');
  const [chatInput, setChatInput] = useState('');

  const categories = ['all', ...STAGE_ORDER];

  const filteredTemplates = templates.filter((template) => {
    const matchesSearch =
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || template.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredDocuments = generatedDocuments.filter((doc) =>
    doc.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const groupedTemplates =
    selectedCategory === 'all'
      ? STAGE_ORDER.map((stage) => ({
          stage,
          items: filteredTemplates.filter((t) => t.category === stage),
        })).filter((g) => g.items.length > 0)
      : [{ stage: selectedCategory, items: filteredTemplates }];

  return (
    <div className="flex h-full flex-col">
      {/* Hero header */}
      <div className="flex-shrink-0 px-6 pt-8 pb-5 md:px-10 md:pt-10">
        <div className="mx-auto w-full max-w-7xl">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className={s.heroBlock}>
              <div className={s.heroEyebrowRow}>
                <div className={s.brandMark}>
                  <Scale className="h-[18px] w-[18px]" />
                </div>
                <span className={`${s.eyebrow} ${s.eyebrowPlain}`}>
                  Legal Documents
                </span>
              </div>
              <h1 className={s.title}>
                Draft your next{' '}
                <span className={s.highlight}>
                  <span className={s.serif}>agreement</span>
                </span>
              </h1>
              <p className={s.sub} style={{ maxWidth: 560 }}>
                Pick a template or describe what you need. The assistant will
                pre-fill fields and open a polished document ready to export.
              </p>
            </div>

            <div
              className={s.tabs}
              role="tablist"
              aria-label="Document view"
            >
              <button
                role="tab"
                aria-selected={viewMode === 'new'}
                className={`${s.tab} ${viewMode === 'new' ? s.tabActive : ''}`}
                onClick={() => setViewMode('new')}
              >
                <Plus className="h-4 w-4" />
                <span>New document</span>
              </button>
              <button
                role="tab"
                aria-selected={viewMode === 'existing'}
                className={`${s.tab} ${viewMode === 'existing' ? s.tabActive : ''}`}
                onClick={() => setViewMode('existing')}
              >
                <Clock className="h-4 w-4" />
                <span>My documents</span>
                <span className={s.tabCount}>{generatedDocuments.length}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Search + filter strip */}
      <div className="flex-shrink-0 px-6 pt-4 md:px-10">
        <div className="mx-auto w-full max-w-7xl space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: 'var(--ink-3)' }}
            />
            <input
              type="text"
              className={s.input}
              placeholder={
                viewMode === 'new'
                  ? 'Search legal templates…'
                  : 'Search your documents…'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: 40 }}
            />
          </div>

          {viewMode === 'new' && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((category) => (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(category)}
                  className={`${s.chipBtn} ${
                    selectedCategory === category ? s.chipBtnActive : ''
                  }`}
                >
                  {category === 'all' ? 'All templates' : category}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <div className={`flex-1 overflow-y-auto ${s.scrollbar}`}>
        <div className="mx-auto w-full max-w-7xl px-6 py-6 md:px-10 md:py-8">
          {viewMode === 'new' ? (
            <div className="space-y-10">
              {/* Assistant banner */}
              <div className={s.banner}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex items-start gap-3">
                    <div className={s.brandMark}>
                      <Sparkles className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3
                        style={{
                          fontSize: 17,
                          fontWeight: 600,
                          letterSpacing: '-0.01em',
                          color: 'var(--ink)',
                        }}
                      >
                        Not sure which template you need?
                      </h3>
                      <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
                        Describe your situation — the assistant recommends a
                        template and pre-fills fields from chat.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-1 items-center gap-2 md:justify-end">
                    <div className="relative flex-1 md:min-w-[300px]">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && chatInput.trim()) {
                            onStartChat(chatInput.trim());
                          }
                        }}
                        placeholder="e.g. NDA for new employees…"
                        className={s.input}
                      />
                    </div>
                    <button
                      className={`${s.btn} ${s.btnAccent}`}
                      onClick={() => onStartChat(chatInput.trim() || undefined)}
                    >
                      <Sparkles className="h-4 w-4" />
                      Ask AI
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {groupedTemplates.length === 0 && (
                <EmptyTemplates query={searchQuery} />
              )}

              {groupedTemplates.map(({ stage, items }) => (
                <section key={stage} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <h2
                      style={{
                        margin: 0,
                        fontSize: 18,
                        fontWeight: 600,
                        color: 'var(--ink)',
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {stage}
                    </h2>
                    <span className={s.pillChip}>{items.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {items.map((template) => (
                      <TemplateCard
                        key={template.id}
                        template={template}
                        onSelect={onNewDocument}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : filteredDocuments.length > 0 ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredDocuments.map((doc) => (
                <DocumentRow key={doc.id} doc={doc} onOpen={onOpenDocument} />
              ))}
            </div>
          ) : (
            <EmptyDocuments onSwitch={() => setViewMode('new')} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Template card ──────────────────────────────────────────────────────────

function TemplateCard({
  template,
  onSelect,
}: {
  template: DocumentTemplate;
  onSelect: (t: DocumentTemplate) => void;
}) {
  return (
    <button
      type="button"
      className={s.card}
      onClick={() => onSelect(template)}
    >
      <div className={s.cardPreview}>
        <span className={s.cardBadge}>
          <Scale className="h-2.5 w-2.5" />
          DOCX
        </span>
        <div className={s.miniPaper}>
          <div className={`${s.miniLine} ${s.miniLineDark}`} style={{ width: '55%', height: 8 }} />
          <hr
            style={{
              border: 'none',
              height: 1,
              background: 'var(--line)',
              margin: '2px 0',
            }}
          />
          <div className={`${s.miniLine}`} style={{ width: '30%', height: 5 }} />
          <div className={`${s.miniLine}`} style={{ width: '92%' }} />
          <div className={`${s.miniLine} ${s.miniLineAccent}`} style={{ width: '72%' }} />
          <div className={`${s.miniLine}`} style={{ width: '88%' }} />
          <div className={`${s.miniLine}`} style={{ width: '30%', height: 5 }} />
          <div className={`${s.miniLine}`} style={{ width: '85%' }} />
          <div className={`${s.miniLine} ${s.miniLineAccent}`} style={{ width: '60%' }} />
        </div>
      </div>
      <div className={s.cardBody}>
        <h3>{template.name}</h3>
        <p>{template.description}</p>
      </div>
      <div className={s.cardFooter}>
        <span
          className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
          style={{ width: '100%' }}
        >
          <Scale className="h-3.5 w-3.5" />
          Generate document
        </span>
      </div>
    </button>
  );
}

// ─── Document row (my documents) ────────────────────────────────────────────

function DocumentRow({
  doc,
  onOpen,
}: {
  doc: GeneratedDocument;
  onOpen: (doc: GeneratedDocument) => void;
}) {
  const preview = doc.content.replace(/<[^>]*>/g, '').slice(0, 150);
  return (
    <button type="button" className={s.docRow} onClick={() => onOpen(doc)}>
      <div className="flex items-start gap-3">
        <div className={s.brandMarkSm}>
          <FileText className="h-[14px] w-[14px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h3
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: 'var(--ink)',
              letterSpacing: '-0.01em',
            }}
            className="truncate"
          >
            {doc.title}
          </h3>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
            {doc.template} · Last edited {doc.lastEdited}
          </p>
        </div>
      </div>
      <p
        style={{
          margin: 0,
          fontSize: 13,
          color: 'var(--ink-2)',
          lineHeight: 1.5,
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {preview}
        {preview.length >= 150 ? '…' : ''}
      </p>
      <div className="mt-auto">
        <span
          className={`${s.btn} ${s.btnOutline} ${s.btnSm}`}
          style={{ width: '100%' }}
        >
          Open document
          <ArrowRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}

// ─── Empty states ───────────────────────────────────────────────────────────

function EmptyTemplates({ query }: { query: string }) {
  return (
    <div
      className={`${s.panel} flex flex-col items-center gap-3 py-16 text-center`}
      style={{ borderStyle: 'dashed' }}
    >
      <FileText className="h-10 w-10" style={{ color: 'var(--ink-4)' }} />
      <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>
        No templates match
      </h3>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-3)', maxWidth: 360 }}>
        {query
          ? `Nothing matched “${query}”. Try a different keyword or clear the filter.`
          : 'Try a different filter.'}
      </p>
    </div>
  );
}

function EmptyDocuments({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div
      className={`${s.panel} mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center`}
      style={{ borderStyle: 'dashed' }}
    >
      <FileText className="h-12 w-12" style={{ color: 'var(--ink-4)' }} />
      <h3 style={{ margin: 0, fontSize: 19, fontWeight: 600, color: 'var(--ink)' }}>
        No documents yet
      </h3>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-3)', maxWidth: 340 }}>
        Generate your first legal document from a template to see it here.
      </p>
      <button
        className={`${s.btn} ${s.btnAccent}`}
        onClick={onSwitch}
        style={{ marginTop: 8 }}
      >
        <Plus className="h-4 w-4" />
        Create new document
      </button>
    </div>
  );
}
