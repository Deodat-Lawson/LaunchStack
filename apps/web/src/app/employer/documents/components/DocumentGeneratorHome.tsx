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
  Briefcase,
  Shield,
  UserCheck,
  Gavel,
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
  nda: 'Confidentiality',
  founders_agreement: 'Formation',
  ip_assignment: 'Formation',
  service_agreement: 'Commercial',
  contractor_agreement: 'Commercial',
  safe: 'Fundraising',
  advisory_agreement: 'Fundraising',
  employment_contract: 'Employment',
  employee_nda: 'Employment',
  invention_assignment: 'Employment',
  at_will_employment: 'Employment',
  non_compete: 'Employment',
  privacy_policy: 'Product',
  terms_of_service: 'Product',
  termination_letter: 'Offboarding',
  severance_agreement: 'Offboarding',
};

const STAGE_ORDER = [
  'Confidentiality',
  'Formation',
  'Commercial',
  'Fundraising',
  'Employment',
  'Product',
  'Offboarding',
];

const STAGE_ICONS: Record<string, React.ReactNode> = {
  Confidentiality: <Shield className="h-4 w-4" />,
  Formation: <Briefcase className="h-4 w-4" />,
  Commercial: <Briefcase className="h-4 w-4" />,
  Fundraising: <Briefcase className="h-4 w-4" />,
  Employment: <UserCheck className="h-4 w-4" />,
  Product: <Shield className="h-4 w-4" />,
  Offboarding: <Gavel className="h-4 w-4" />,
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

  const totalTemplates = templates.length;
  const categoryCounts: Record<string, number> = {};
  for (const tpl of templates) {
    categoryCounts[tpl.category] = (categoryCounts[tpl.category] ?? 0) + 1;
  }

  return (
    <div className={s.libContent}>
      <div className={s.libContentInner}>
        {/* Title row + view tabs (matches `rd-content__h` spacing exactly) */}
        <div className={s.libContentHead}>
          <h1 className={s.libHeroHeading}>
            Generate a <em>legal</em> document
          </h1>
          <div className={s.tabs} role="tablist" aria-label="Document view">
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
        <p className={s.libHeroSub}>
          Pick a template — Drift fills it from your company knowledge and the
          counterparty. Or describe what you need and the assistant will
          recommend the right one.
        </p>

        {/* Search + filter strip — kept compact, sized like the design's chips */}
        <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className={`${s.searchWrap} relative`}>
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
            <kbd className={s.kbd}>⌘K</kbd>
          </div>

          {viewMode === 'new' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', overflowX: 'auto' }}>
              {categories.map((category) => {
                const count =
                  category === 'all'
                    ? totalTemplates
                    : (categoryCounts[category] ?? 0);
                return (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`${s.chipBtn} ${
                      selectedCategory === category ? s.chipBtnActive : ''
                    }`}
                  >
                    {category === 'all' ? 'All' : category}
                    <span style={{ color: 'var(--ink-4)', marginLeft: 4 }}>{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Body */}
        {viewMode === 'new' ? (
          <>
            {/* Assistant banner */}
            <div className={s.libSection}>
              <div className={s.banner}>
                <div className="flex flex-col gap-4 md:flex-row md:items-center">
                  <div className="flex items-start gap-3">
                    <div className={s.brandMark}>
                      <Sparkles className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <h3
                        style={{
                          fontSize: 14,
                          fontWeight: 500,
                          letterSpacing: '-0.005em',
                          color: 'var(--ink)',
                        }}
                      >
                        Not sure which template you need?
                      </h3>
                      <p style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, margin: 0 }}>
                        Describe your situation — the assistant recommends a
                        template and pre-fills fields from chat as you answer.
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
                      className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
                      onClick={() => onStartChat(chatInput.trim() || undefined)}
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      Ask AI
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Recent in workspace */}
            {generatedDocuments.length > 0 && selectedCategory === 'all' && !searchQuery && (
              <section className={s.libSection}>
                <div className={s.libSectionHead}>
                  <h2 className={s.libSectionTitle}>Recent in your workspace</h2>
                  <span className={s.libSectionMono}>
                    {Math.min(3, generatedDocuments.length)} of {generatedDocuments.length}
                  </span>
                </div>
                <div className={s.libGrid}>
                  {generatedDocuments.slice(0, 3).map((doc) => (
                    <RecentTile key={doc.id} doc={doc} onOpen={onOpenDocument} />
                  ))}
                </div>
              </section>
            )}

            {groupedTemplates.length === 0 && (
              <EmptyTemplates query={searchQuery} />
            )}

            {/* Templates grouped by category */}
            {groupedTemplates.map(({ stage, items }) => (
              <section key={stage} className={s.libSection}>
                <div className={s.libSectionHead}>
                  <h2 className={s.libSectionTitle}>{stage}</h2>
                  <span className={s.libSectionMono}>
                    {items.length} {items.length === 1 ? 'template' : 'templates'}
                  </span>
                </div>
                <div className={s.libGrid}>
                  {items.map((template) => (
                    <TemplateTile
                      key={template.id}
                      template={template}
                      onSelect={onNewDocument}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        ) : filteredDocuments.length > 0 ? (
          <section className={s.libSection}>
            <div className={s.libSectionHead}>
              <h2 className={s.libSectionTitle}>My documents</h2>
              <span className={s.libSectionMono}>
                {filteredDocuments.length} of {generatedDocuments.length}
              </span>
            </div>
            <div className={s.libGrid}>
              {filteredDocuments.map((doc) => (
                <RecentTile key={doc.id} doc={doc} onOpen={onOpenDocument} />
              ))}
            </div>
          </section>
        ) : (
          <EmptyDocuments onSwitch={() => setViewMode('new')} />
        )}
      </div>
    </div>
  );
}

// ─── Template tile (Drift `rd-tile` shape) ──────────────────────────────────

function TemplateTile({
  template,
  onSelect,
}: {
  template: DocumentTemplate;
  onSelect: (t: DocumentTemplate) => void;
}) {
  const fieldCount = template.fields?.length ?? 0;
  const requiredCount = template.fields?.filter((f) => f.required).length ?? 0;
  const icon = STAGE_ICONS[template.category] ?? <FileText className="h-4 w-4" />;
  const fieldText =
    fieldCount > 0
      ? `${fieldCount} field${fieldCount === 1 ? '' : 's'}`
      : '';
  return (
    <button type="button" className={s.libTile} onClick={() => onSelect(template)}>
      <div className={s.libTileIcon}>{icon}</div>
      <div className={s.libTileTitle}>{template.name}</div>
      <p className={s.libTileSub}>
        {template.category}
        {fieldText ? ` · ${fieldText}` : ''}
        {requiredCount > 0 && requiredCount < fieldCount ? ` · ${requiredCount} required` : ''}
      </p>
      <div className={s.libTileMeta}>
        <span>DOCX</span>
        <span>Open →</span>
      </div>
    </button>
  );
}

// ─── Recent doc tile (same `rd-tile` shape) ─────────────────────────────────

function RecentTile({
  doc,
  onOpen,
}: {
  doc: GeneratedDocument;
  onOpen: (doc: GeneratedDocument) => void;
}) {
  return (
    <button type="button" className={s.libTile} onClick={() => onOpen(doc)}>
      <div className={s.libTileIcon}>
        <FileText className="h-4 w-4" />
      </div>
      <div
        className={s.libTileTitle}
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {doc.title}
      </div>
      <p className={s.libTileSub}>
        {doc.template} · edited {doc.lastEdited}
      </p>
      <div className={s.libTileMeta}>
        <span>DRAFT</span>
        <span>Open →</span>
      </div>
    </button>
  );
}

// ─── Empty states ────────────────────────────────────────────────────────────

function EmptyTemplates({ query }: { query: string }) {
  return (
    <div
      className={`${s.panel} flex flex-col items-center gap-3 py-16 text-center`}
      style={{ borderStyle: 'dashed' }}
    >
      <FileText className="h-10 w-10" style={{ color: 'var(--ink-4)' }} />
      <h3 style={{ margin: 0, fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
        No templates match
      </h3>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', maxWidth: 360 }}>
        {query
          ? `Nothing matched "${query}". Try a different keyword or clear the filter.`
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
      <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: 'var(--ink)' }}>
        No documents yet
      </h3>
      <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', maxWidth: 340 }}>
        Generate your first legal document from a template to see it here.
      </p>
      <button
        className={`${s.btn} ${s.btnAccent} ${s.btnSm}`}
        onClick={onSwitch}
        style={{ marginTop: 8 }}
      >
        <Plus className="h-3.5 w-3.5" />
        Create new document
      </button>
    </div>
  );
}
