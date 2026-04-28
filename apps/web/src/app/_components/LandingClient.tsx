'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  ArrowRight,
  Check,
  FileText,
  Github,
  Link2,
  Play,
  Plus,
  Sparkles,
  Terminal,
} from 'lucide-react';
import { MarketingShell } from './MarketingShell';
import { createHeroGraph, type HeroGraphApi } from './heroGraph';
import { runHeroDemo } from './heroDemo';
import styles from '../../styles/marketing.module.css';

const GITHUB_REPO = 'https://github.com/Deodat-Lawson/pdr_ai_v2';

const CONNECTORS = [
  { name: 'Gmail', desc: 'Threads, labels, attachments. Scope by label.', tag: 'Live' },
  { name: 'Notion', desc: 'Pages, databases, nested blocks — live sync.', tag: 'Live' },
  { name: 'Google Drive', desc: 'Docs, Sheets, PDFs — folder-scoped.', tag: 'Live' },
  { name: 'Slack', desc: 'Channels + DMs. Pick what\u2019s in scope.', tag: 'Live' },
  { name: 'GitHub', desc: 'Issues, PRs, READMEs, your own gists.', tag: 'Live' },
  { name: 'Dropbox', desc: 'Files + Paper docs, folder-scoped.', tag: 'Live' },
  { name: 'Linear', desc: 'Issues, projects, cycles — searchable.', tag: 'Beta', soon: true },
  { name: 'Calendar', desc: 'Events + attendees give calls context.', tag: 'Beta', soon: true },
];

const FORMATS: Array<{ ext: string; name: string; kind: 'doc' | 'audio' | 'video' | 'image' | 'code' | 'data' }> = [
  { ext: 'PDF', name: 'Papers, books', kind: 'doc' },
  { ext: 'DOCX', name: 'Word docs', kind: 'doc' },
  { ext: 'MD', name: 'Markdown', kind: 'doc' },
  { ext: 'TXT', name: 'Plain text', kind: 'doc' },
  { ext: 'MP3', name: 'Podcasts, calls', kind: 'audio' },
  { ext: 'WAV', name: 'Lossless audio', kind: 'audio' },
  { ext: 'M4A', name: 'Voice memos', kind: 'audio' },
  { ext: 'MP4', name: 'Recorded calls', kind: 'video' },
  { ext: 'MOV', name: 'QuickTime', kind: 'video' },
  { ext: 'PNG', name: 'Screenshots', kind: 'image' },
  { ext: 'JPG', name: 'Photos', kind: 'image' },
  { ext: 'PY', name: 'Python', kind: 'code' },
  { ext: 'TS', name: 'TypeScript', kind: 'code' },
  { ext: 'CSV', name: 'Tables', kind: 'data' },
  { ext: 'JSON', name: 'Structured data', kind: 'data' },
  { ext: 'XLSX', name: 'Spreadsheets', kind: 'data' },
];

const FAQS = [
  {
    q: 'Is it really open source?',
    a: `Yes — the retrieval core (chunking, embeddings, graph, cited synthesis) is Apache 2.0–licensed on GitHub. The hosted app adds the polished UI, connectors, and billing — you can skip all of that and run the engine yourself.`,
  },
  {
    q: 'Do you train on my data?',
    a: `Never — we do not train on your data. Your sources stay in your workspace. For maximum control, self-host with your own API keys so only the LLM calls you explicitly enable leave your environment.`,
  },
  {
    q: 'What happens to my Gmail/Notion data?',
    a: `We read via OAuth — scoped to the folders/labels you pick. Content is encrypted at rest. Revoke anytime; your index is deleted within 24 hours.`,
  },
  {
    q: 'Do I need my own API keys?',
    a: `Yes — self-hosted Launchstack uses your own OpenAI, Anthropic, or Google AI keys. You are not locked into our pricing and you maintain full control over your AI usage and costs.`,
  },
  {
    q: 'Can I edit sources inside Launchstack?',
    a: `Yes — markdown docs and transcripts are fully editable with auto-snapshot version history. PDFs and media are annotation-only.`,
  },
];

export function LandingClient() {
  return (
    <MarketingShell>
      <Hero />
      <KnowledgePipeline />
      <Stats />
      <Problem />
      <Sources />
      <HowItWorks />
      <Testimonials />
      <Pricing />
      <FAQ />
      <OpenSource />
      <FinalCta />
    </MarketingShell>
  );
}

function Hero() {
  return (
    <section className={styles.hero}>
      <div className={styles.heroBg} />
      <div className={styles.heroGrid} />

      <div className={styles.heroCopy}>
        <div className={styles.pill}>
          <span className={styles.pillBadge}>OPEN SOURCE</span>
          Free, Apache 2.0–licensed, self-hostable →
        </div>

        <h1 className={styles.heroTitle}>
          The notes, calls, and docs you&rsquo;ve stacked up —<br />
          <span className={styles.highlight}>
            <span className={styles.serif}>finally answering back.</span>
          </span>
        </h1>

        <p className={styles.heroSub}>
          The open-source knowledge graph for founders. Ask once. Get cited
          answers.
        </p>

        <div className={styles.heroCtas}>
          <Link
            href="/signup"
            className={`${styles.btn} ${styles.btnAccent} ${styles.btnLg}`}
          >
            Start free — no card needed
            <ArrowRight size={16} />
          </Link>
          <Link
            href="/deployment"
            className={`${styles.btn} ${styles.btnOutline} ${styles.btnLg}`}
          >
            <Play size={16} />
            Deployment guide
          </Link>
        </div>

        <div className={styles.heroMeta}>
          <span className={styles.liveDot} />
          <span>Free & open source</span>
          <span className={styles.sep}>·</span>
          <span>Self-host with your own API keys</span>
          <span className={styles.sep}>·</span>
          <span>Apache 2.0 licensed</span>
        </div>
      </div>

      <HeroStage />
    </section>
  );
}

function HeroStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const nodeCountRef = useRef<HTMLSpanElement | null>(null);
  const scopeCountRef = useRef<HTMLSpanElement | null>(null);
  const chipCountRef = useRef<HTMLSpanElement | null>(null);
  const heroRef = useRef<HeroGraphApi | null>(null);

  const { resolvedTheme } = useTheme();

  // Start / stop the graph + demo sequencer.
  useEffect(() => {
    if (!canvasRef.current || !composerRef.current || !threadRef.current) return;

    const themeName = resolvedTheme === 'dark' ? 'dark' : 'light';
    const hero = createHeroGraph(canvasRef.current, { theme: themeName });
    heroRef.current = hero;

    if (nodeCountRef.current) {
      nodeCountRef.current.textContent = String(hero.graph.nodes.length);
    }

    const demo = runHeroDemo(hero, composerRef.current, threadRef.current, {
      msg: styles.hdMsg!,
      msgUser: styles.hdMsgU!,
      msgAi: styles.hdMsgA!,
      sources: styles.hdSources!,
      chip: styles.hdChip!,
      body: styles.hdBody!,
      inlineChip: styles.hdInlineChip!,
      typing: styles.composerTyping!,
    });

    const refreshScope = () => {
      if (!heroRef.current) return;
      const n = heroRef.current.graph.nodes.filter((x) => x.checked).length;
      if (scopeCountRef.current) scopeCountRef.current.textContent = String(n);
      if (chipCountRef.current) chipCountRef.current.textContent = n === 1 ? '1 source' : `${n} sources`;
    };
    const scopeTimer = window.setInterval(refreshScope, 200);

    return () => {
      window.clearInterval(scopeTimer);
      demo.stop();
      hero.stop();
      heroRef.current = null;
    };
    // Only re-mount when theme changes (re-init to repaint with new palette).
  }, [resolvedTheme]);

  return (
    <div className={styles.stage}>
      <canvas ref={canvasRef} className={styles.stageCanvas} aria-hidden />
      <div className={styles.stageOverlay} />

      <div className={styles.stageLegend}>
        <span className={styles.stageLegendDot} />
        <span>
          Your knowledge graph · <b ref={nodeCountRef}>23</b> sources
        </span>
      </div>

      <div className={styles.stageCount}>
        <span className={styles.chip}>
          <b ref={scopeCountRef}>0</b>
          {' '}in scope
        </span>
      </div>

      <div ref={threadRef} className={styles.stageThread} />

      <div className={styles.stageComposer}>
        <span className={styles.sourcesChip}>
          <span className={styles.dot} />
          <span ref={chipCountRef}>0 sources</span>
        </span>
        <div ref={composerRef} className={styles.composerText} />
        <span className={styles.kbd}>⌘↵</span>
        <button type="button" className={styles.sendBtn} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── Knowledge Pipeline section ──────────────────────────────────────────────
// Drift "knowledge-pipeline" animation: sources (Gmail, Notion, PDF, Audio,
// GitHub) flow into a knowledge graph + embeddings, then out to consumers
// (OpenAI, Anthropic, Claude Code, n8n). 14s loop driven by rAF; particles
// sample bezier paths each frame and synchronously trigger card pulses on
// delivery.

const KP_STAGE_W = 1920;
const KP_STAGE_H = 1080;
const KP_CARD_W = 260;
const KP_CARD_H = 70;
const KP_SRC_X = 140;
const KP_CON_X = KP_STAGE_W - 140 - KP_CARD_W;
const KP_HUB_X = KP_STAGE_W / 2;
const KP_HUB_Y_GRAPH = 440;
const KP_HUB_Y_EMBED = 780;
const KP_LOOP = 14;

type KpPt = { x: number; y: number };
type KpCard = {
  id: string;
  label: string;
  meta: string;
  y: number;
  Icon: React.ComponentType;
};

const KP_SOURCES: KpCard[] = [
  { id: 'gmail',  label: 'Gmail',  meta: 'email · 14,204',      y: 220, Icon: IconGmail  },
  { id: 'notion', label: 'Notion', meta: 'docs · 312 pages',    y: 360, Icon: IconNotion },
  { id: 'pdf',    label: 'PDF',    meta: 'files · 87 uploaded', y: 500, Icon: IconPDF    },
  { id: 'audio',  label: 'Audio',  meta: 'recordings · 42',     y: 640, Icon: IconAudio  },
  { id: 'github', label: 'GitHub', meta: 'repos · 6 connected', y: 780, Icon: IconGithub },
];

const KP_CONSUMERS: KpCard[] = [
  { id: 'openai',    label: 'OpenAI',      meta: 'gpt-5 · embed-3',      y: 260, Icon: IconOpenAI     },
  { id: 'anthropic', label: 'Anthropic',   meta: 'claude-sonnet-4.5',    y: 400, Icon: IconAnthropic  },
  { id: 'claude',    label: 'Claude Code', meta: 'agent · long-running', y: 540, Icon: IconClaudeCode },
  { id: 'n8n',       label: 'n8n',         meta: 'workflow · 14 nodes',  y: 680, Icon: IconN8n        },
];

const KP_GRAPH_CENTER: KpPt = { x: KP_HUB_X, y: KP_HUB_Y_GRAPH };
const KP_EMBED_CENTER: KpPt = { x: KP_HUB_X, y: KP_HUB_Y_EMBED };

const kpPctX = (px: number) => `${(px / KP_STAGE_W) * 100}%`;
const kpPctY = (py: number) => `${(py / KP_STAGE_H) * 100}%`;
const kpClamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function kpCurvePath(a: KpPt, b: KpPt) {
  const dx = (b.x - a.x) * 0.55;
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}
function kpBezier(a: KpPt, b: KpPt, t: number): KpPt {
  const dx = (b.x - a.x) * 0.55;
  const c1x = a.x + dx, c1y = a.y;
  const c2x = b.x - dx, c2y = b.y;
  const u = 1 - t;
  return {
    x: u*u*u*a.x + 3*u*u*t*c1x + 3*u*t*t*c2x + t*t*t*b.x,
    y: u*u*u*a.y + 3*u*u*t*c1y + 3*u*t*t*c2y + t*t*t*b.y,
  };
}

// Knowledge graph: 1 core + ring(60,6) + ring(110,10) + ring(155,12) = 29 nodes
type KpNode = { x: number; y: number; r: number };
const KP_GRAPH_NODES: KpNode[] = (() => {
  const nodes: KpNode[] = [];
  const cx = KP_GRAPH_CENTER.x, cy = KP_GRAPH_CENTER.y;
  nodes.push({ x: cx, y: cy, r: 7 });
  const rings = [
    { r: 60,  count: 6,  offset: 0    },
    { r: 110, count: 10, offset: 0.25 },
    { r: 155, count: 12, offset: 0.6  },
  ];
  rings.forEach((ring, ri) => {
    for (let i = 0; i < ring.count; i++) {
      const a = ((i + ring.offset) / ring.count) * Math.PI * 2;
      const rp = ring.r + Math.sin(i * 2.3 + ri) * 8;
      nodes.push({
        x: cx + Math.cos(a) * rp,
        y: cy + Math.sin(a) * rp * 0.72,
        r: ri === 2 ? 2.5 : ri === 1 ? 3.5 : 4.5,
      });
    }
  });
  return nodes;
})();

// Edges: each outer connects to nearest middle, each middle to nearest inner,
// each inner to core.
const KP_GRAPH_EDGES: Array<[number, number]> = (() => {
  const out: Array<[number, number]> = [];
  const middleStart = 1 + 6;
  const outerStart  = 1 + 6 + 10;
  const nodes = KP_GRAPH_NODES;
  for (let i = outerStart; i < nodes.length; i++) {
    let best = -1, bestD = Infinity;
    for (let j = middleStart; j < outerStart; j++) {
      const d = Math.hypot(nodes[i]!.x - nodes[j]!.x, nodes[i]!.y - nodes[j]!.y);
      if (d < bestD) { bestD = d; best = j; }
    }
    out.push([i, best]);
  }
  for (let j = middleStart; j < outerStart; j++) {
    let best = -1, bestD = Infinity;
    for (let k = 1; k < middleStart; k++) {
      const d = Math.hypot(nodes[j]!.x - nodes[k]!.x, nodes[j]!.y - nodes[k]!.y);
      if (d < bestD) { bestD = d; best = k; }
    }
    out.push([j, best]);
  }
  for (let k = 1; k < middleStart; k++) out.push([k, 0]);
  return out;
})();

type KpFlow = {
  id: string;
  from: KpPt;
  to: KpPt;
  kind: 'in' | 'out';
  cardId: string;
  delay: number;
  period: number;
  lifetime: number;
};
const KP_FLOWS: KpFlow[] = [
  ...KP_SOURCES.map((s, i): KpFlow => ({
    id: `in-${s.id}`,
    from: { x: KP_SRC_X + KP_CARD_W, y: s.y + KP_CARD_H / 2 },
    to: KP_GRAPH_CENTER,
    kind: 'in',
    cardId: s.id,
    delay: i * 0.35,
    period: 3.2,
    lifetime: 2.4,
  })),
  ...KP_CONSUMERS.map((c, i): KpFlow => ({
    id: `out-${c.id}`,
    from: KP_EMBED_CENTER,
    to: { x: KP_CON_X, y: c.y + KP_CARD_H / 2 },
    kind: 'out',
    cardId: c.id,
    delay: 4 + i * 0.5,
    period: 3.5,
    lifetime: 2.2,
  })),
];

function useKpTime(loop = KP_LOOP) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    let raf = 0;
    let start = 0;
    const tick = (ts: number) => {
      if (!start) start = ts;
      setT(((ts - start) / 1000) % loop);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loop]);
  return t;
}

function KnowledgePipeline() {
  return (
    <section id="pipeline" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>The pipeline</div>
        <p className={styles.lead}>
          Gmail threads, Notion pages, PDFs, call recordings, and your GitHub
          repos stream into one living knowledge graph. Embeddings index
          meaning — not just keywords — so every LLM, agent, and workflow
          queries the same brain, with citations, every time.
        </p>

        <div
          className="kp-stage"
          role="img"
          aria-label="Sources flow into a knowledge graph and embeddings, then out to model consumers."
        >
          <style>{KP_CSS}</style>
          <KnowledgePipelineStage />
        </div>
      </div>
    </section>
  );
}

function KnowledgePipelineStage() {
  const time = useKpTime();

  const activeSources: Record<string, boolean> = {};
  const activeConsumers: Record<string, boolean> = {};
  let coreActivity = 0;
  const particles: React.ReactNode[] = [];

  for (const p of KP_FLOWS) {
    let effT = (time - p.delay) % p.period;
    if (effT < 0) effT += p.period;
    if (effT > p.lifetime) continue;
    const prog = effT / p.lifetime;
    for (let idx = 0; idx < 2; idx++) {
      const pr = prog - (idx === 0 ? 0 : 0.35);
      if (pr < 0 || pr > 1) continue;
      const pt = kpBezier(p.from, p.to, pr);
      const hue = p.kind === 'in' ? 285 : 340;
      const size = idx === 0 ? 5 : 3.5;
      const alpha = pr < 0.1 ? pr / 0.1 : pr > 0.9 ? (1 - pr) / 0.1 : 1;
      particles.push(
        <circle
          key={`${p.id}-${idx}`}
          cx={pt.x}
          cy={pt.y}
          r={size}
          fill={`oklch(0.65 0.22 ${hue} / ${alpha * 0.9})`}
          style={{
            filter: `drop-shadow(0 0 6px oklch(0.65 0.22 ${hue} / ${alpha * 0.6}))`,
          }}
        />
      );
      if (p.kind === 'in') {
        if (pr < 0.08) activeSources[p.cardId] = true;
        if (pr > 0.88) coreActivity = Math.max(coreActivity, 1 - (pr - 0.88) / 0.12);
      } else if (pr > 0.88) {
        activeConsumers[p.cardId] = true;
      }
    }
  }

  const nodeActivity: number[] = KP_GRAPH_NODES.map((_, i) =>
    i === 0 ? 0 : kpClamp(Math.sin(time * 0.8 + i * 1.3) * 0.5 + 0.4, 0, 1)
  );

  return (
    <>
      <div className="kp-amb" aria-hidden>
        <div className="kp-orb kp-orb-a" />
        <div className="kp-orb kp-orb-b" />
        <div className="kp-orb kp-orb-c" />
      </div>
      <div className="kp-dots" aria-hidden />

      <div className="kp-eyebrow kp-eyebrow--src" style={{ left: kpPctX(KP_SRC_X) }}>
        <span className="kp-eyebrow__line" />Sources
      </div>
      <div className="kp-eyebrow kp-eyebrow--idx">
        <span className="kp-eyebrow__line" />Index
      </div>
      <div className="kp-eyebrow kp-eyebrow--con" style={{ left: kpPctX(KP_CON_X) }}>
        <span className="kp-eyebrow__line" />Consumers
      </div>

      <svg
        className="kp-svg"
        viewBox={`0 0 ${KP_STAGE_W} ${KP_STAGE_H}`}
        preserveAspectRatio="xMidYMid meet"
        aria-hidden
      >
        <defs>
          <linearGradient id="kp-path-in" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="oklch(0.54 0.24 285)" stopOpacity="0.08" />
            <stop offset="60%"  stopColor="oklch(0.54 0.24 285)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="oklch(0.54 0.24 285)" stopOpacity="0.08" />
          </linearGradient>
          <linearGradient id="kp-path-out" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%"   stopColor="oklch(0.70 0.22 340)" stopOpacity="0.08" />
            <stop offset="40%"  stopColor="oklch(0.70 0.22 340)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="oklch(0.70 0.22 340)" stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {KP_FLOWS.map((p) => (
          <path
            key={p.id}
            d={kpCurvePath(p.from, p.to)}
            stroke={p.kind === 'in' ? 'url(#kp-path-in)' : 'url(#kp-path-out)'}
            strokeWidth={1.5}
            fill="none"
          />
        ))}

        <ellipse
          cx={KP_GRAPH_CENTER.x}
          cy={KP_GRAPH_CENTER.y}
          rx={185}
          ry={140}
          fill="none"
          stroke="oklch(0.78 0.012 285)"
          strokeDasharray="3 5"
          strokeWidth={1}
          opacity={0.5}
        />

        {KP_GRAPH_EDGES.map(([a, b], i) => {
          const na = KP_GRAPH_NODES[a]!;
          const nb = KP_GRAPH_NODES[b]!;
          return (
            <line
              key={`edge-${i}`}
              x1={na.x}
              y1={na.y}
              x2={nb.x}
              y2={nb.y}
              stroke="oklch(0.62 0.12 285)"
              strokeWidth={1}
              opacity={0.15 + 0.35 * coreActivity}
            />
          );
        })}

        {KP_GRAPH_NODES.map((n, i) => {
          const act = i === 0 ? coreActivity : nodeActivity[i]!;
          return (
            <g key={`node-${i}`}>
              {act > 0.05 && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 4 + act * 6}
                  fill="none"
                  stroke="oklch(0.54 0.24 285)"
                  strokeWidth={1}
                  opacity={act * 0.6}
                />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r + act * 2}
                fill={
                  i === 0
                    ? `oklch(${0.54 + act * 0.12} 0.24 285)`
                    : `oklch(${0.62 + act * 0.1} ${0.12 + act * 0.1} 285)`
                }
                opacity={0.5 + act * 0.5}
              />
            </g>
          );
        })}

        <text
          x={KP_GRAPH_CENTER.x}
          y={KP_GRAPH_CENTER.y - 180}
          textAnchor="middle"
          fontSize={14}
          letterSpacing={2}
          fill="oklch(0.58 0.015 285)"
          style={{ fontFamily: 'var(--font-jetbrains-mono, ui-monospace, monospace)' }}
        >
          KNOWLEDGE GRAPH
        </text>
        <text
          x={KP_GRAPH_CENTER.x}
          y={KP_GRAPH_CENTER.y + 200}
          textAnchor="middle"
          fontSize={15}
          fontWeight={500}
          fill="oklch(0.42 0.02 285)"
        >
          {Math.round(48 + coreActivity * 12)} entities · {KP_GRAPH_EDGES.length} relations
        </text>

        {particles}
      </svg>

      {KP_SOURCES.map((s) => (
        <KpCardEl
          key={s.id}
          x={KP_SRC_X}
          y={s.y}
          active={!!activeSources[s.id]}
          Icon={s.Icon}
          label={s.label}
          meta={s.meta}
        />
      ))}
      {KP_CONSUMERS.map((c) => (
        <KpCardEl
          key={c.id}
          x={KP_CON_X}
          y={c.y}
          active={!!activeConsumers[c.id]}
          Icon={c.Icon}
          label={c.label}
          meta={c.meta}
        />
      ))}

      <KpEmbeddings activity={coreActivity} time={time} />

      <div className="kp-title">
        <h3 className="kp-title__head">
          Your data, <em>indexed</em>, queryable.
        </h3>
        <p className="kp-title__sub">
          Sources · Knowledge graph · Embeddings · Any model, any workflow
        </p>
      </div>
    </>
  );
}

function KpCardEl({
  x,
  y,
  active,
  Icon,
  label,
  meta,
}: {
  x: number;
  y: number;
  active: boolean;
  Icon: React.ComponentType;
  label: string;
  meta: string;
}) {
  return (
    <div
      className={`kp-card${active ? ' kp-card--active' : ''}`}
      style={{
        left: kpPctX(x),
        top: kpPctY(y + KP_CARD_H / 2),
        width: `${(KP_CARD_W / KP_STAGE_W) * 100}%`,
      }}
    >
      <div className="kp-card__pulse" aria-hidden />
      <div className="kp-card__icon">
        <Icon />
      </div>
      <div className="kp-card__text">
        <div className="kp-card__label">{label}</div>
        <div className="kp-card__meta">{meta}</div>
      </div>
    </div>
  );
}

function KpEmbeddings({ activity, time }: { activity: number; time: number }) {
  const bars: React.ReactNode[] = [];
  for (let i = 0; i < 24; i++) {
    const base = 0.35 + 0.55 * Math.abs(Math.sin(i * 1.7 + 2.1));
    const wave = 0.15 * Math.sin(time * 2.2 - i * 0.45);
    const h = kpClamp((base + wave) * (0.65 + 0.35 * activity), 0.08, 1);
    bars.push(
      <div
        key={i}
        className="kp-embed__bar"
        style={{ height: `${h * 100}%`, opacity: 0.45 + 0.45 * activity }}
      />
    );
  }
  return (
    <div
      className="kp-embed"
      style={{ transform: `translateX(-50%) scale(${0.98 + activity * 0.02})` }}
    >
      <div className="kp-embed__head">
        <span className="kp-embed__title">Embeddings</span>
        <span className="kp-embed__meta">1,536 dim · cosine</span>
      </div>
      <div className="kp-embed__bars">{bars}</div>
    </div>
  );
}

// ── Brand glyphs (geometric homages, not traced logos). ───────────────────
function IconGmail() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="2" fill="#fff" stroke="#e6e6e6" strokeWidth={1} />
      <path d="M3 7l9 6 9-6" stroke="#EA4335" strokeWidth={1.6} fill="none" strokeLinejoin="round" />
      <path d="M3 7v10h3V10L3 7z" fill="#C5221F" />
      <path d="M21 7v10h-3V10l3-3z" fill="#4285F4" />
      <path d="M6 10l6 4 6-4v7H6v-7z" fill="#FBBC04" opacity={0.25} />
    </svg>
  );
}
function IconNotion() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="#fff" stroke="#111" strokeWidth={1.2} />
      <path d="M8 7v10M8 7l8 10M16 7v10" stroke="#111" strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  );
}
function IconPDF() {
  return (
    <svg viewBox="0 0 20 22" fill="none" aria-hidden>
      <path d="M3 1h10l4 4v15a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="#fff" stroke="#d0d0d0" />
      <path d="M13 1v4h4" fill="none" stroke="#d0d0d0" />
      <rect x="3" y="12" width="14" height="6" rx="1" fill="#E53935" />
      <text x="10" y="16.5" textAnchor="middle" fontSize="4.5" fontWeight={700} fill="#fff" fontFamily="Inter, sans-serif">PDF</text>
    </svg>
  );
}
function IconAudio() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="oklch(0.72 0.18 200 / 0.15)" stroke="oklch(0.55 0.18 200)" strokeWidth={1.2} />
      <g stroke="oklch(0.45 0.18 200)" strokeWidth={1.8} strokeLinecap="round">
        <line x1="8"    y1="9"  x2="8"    y2="15" />
        <line x1="10.5" y1="7"  x2="10.5" y2="17" />
        <line x1="13"   y1="10" x2="13"   y2="14" />
        <line x1="15.5" y1="8"  x2="15.5" y2="16" />
      </g>
    </svg>
  );
}
function IconGithub() {
  return (
    <svg viewBox="0 0 24 24" fill="#181717" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.38 7.86 10.9.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.68-1.28-1.68-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.95.1-.74.4-1.25.73-1.54-2.56-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.2-3.1-.12-.3-.52-1.48.11-3.08 0 0 .98-.31 3.2 1.19a11.1 11.1 0 0 1 5.82 0c2.22-1.5 3.2-1.19 3.2-1.19.63 1.6.23 2.78.11 3.08.75.81 1.2 1.84 1.2 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.07.78 2.15v3.18c0 .31.21.67.8.56C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  );
}
function IconOpenAI() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="11" fill="#0D0D0D" />
      <path
        d="M16.5 9.5l-4.5 -2.6 -4.5 2.6v5.2l4.5 2.6 4.5 -2.6zM12 9.8l3 1.7 -3 1.7 -3 -1.7z"
        stroke="#fff"
        strokeWidth={0.8}
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function IconAnthropic() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#D97757" />
      <path d="M9 17L12 7l3 10M10.2 13.5h3.6" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function IconClaudeCode() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="4" fill="#0D0D0D" />
      <path d="M8 10l-2 2 2 2M16 10l2 2 -2 2M13.5 8l-3 8" stroke="#D97757" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function IconN8n() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="5" cy="12" r="2.2" fill="#EA4B71" />
      <circle cx="12" cy="7" r="2.2" fill="#EA4B71" />
      <circle cx="12" cy="17" r="2.2" fill="#EA4B71" />
      <circle cx="19" cy="12" r="2.2" fill="#EA4B71" />
      <path d="M7 12C8.5 8.5 10 7 12 7M7 12c1.5 3.5 3 5 5 5M14 7c1.8 1 4.2 4 5 5M14 17c1.8 -1 4.2 -4 5 -5" stroke="#EA4B71" strokeWidth={1.4} strokeLinecap="round" fill="none" opacity={0.7} />
    </svg>
  );
}

const KP_CSS = `
.kp-stage {
  position: relative;
  width: 100%;
  max-width: 1180px;
  margin: 40px auto 0;
  aspect-ratio: 16 / 9;
  border-radius: 22px;
  background: var(--bg);
  border: 1px solid var(--line-2);
  box-shadow: 0 40px 80px oklch(0 0 0 / 0.08), 0 8px 24px oklch(0 0 0 / 0.04);
  overflow: hidden;
  isolation: isolate;
  color: var(--ink);
}
:global(.dark) .kp-stage,
:global([data-theme="dark"]) .kp-stage {
  box-shadow: 0 40px 100px oklch(0 0 0 / 0.5);
}

/* Ambient orbs — quieter than default; content is the focus. */
.kp-amb { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.kp-orb {
  position: absolute; border-radius: 50%;
  filter: blur(100px); opacity: 0.55;
  will-change: transform;
}
.kp-orb-a {
  width: 700px; height: 700px; left: -120px; top: -120px;
  background: radial-gradient(circle, oklch(0.54 0.24 285 / 0.35) 0%, transparent 65%);
  animation: kp-drift-a 28s ease-in-out infinite alternate;
}
.kp-orb-b {
  width: 780px; height: 780px; right: -140px; top: 200px;
  background: radial-gradient(circle, oklch(0.70 0.22 340 / 0.30) 0%, transparent 65%);
  animation: kp-drift-b 34s ease-in-out infinite alternate;
}
.kp-orb-c {
  width: 680px; height: 680px; left: 38%; top: 60%;
  background: radial-gradient(circle, oklch(0.72 0.18 200 / 0.28) 0%, transparent 65%);
  animation: kp-drift-c 38s ease-in-out infinite alternate;
}
@keyframes kp-drift-a { 50% { transform: translate(120px, 80px) scale(1.08); } 100% { transform: translate(60px, 160px) scale(0.96); } }
@keyframes kp-drift-b { 50% { transform: translate(-80px, 120px) scale(1.10); } 100% { transform: translate(-160px, 40px) scale(0.94); } }
@keyframes kp-drift-c { 50% { transform: translate(140px, -60px) scale(0.96); } 100% { transform: translate(-100px, 80px) scale(1.06); } }

/* Dot grid — masked to ellipse so the edges fade out */
.kp-dots {
  position: absolute; inset: -40px;
  background-image: radial-gradient(circle at 1px 1px, oklch(0.55 0.015 285) 1px, transparent 1.5px);
  background-size: 28px 28px;
  opacity: 0.2;
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 50%, black 0%, black 40%, transparent 85%);
          mask-image: radial-gradient(ellipse 60% 50% at 50% 50%, black 0%, black 40%, transparent 85%);
  pointer-events: none;
}

/* Column eyebrows — small mono, with a leading rule */
.kp-eyebrow {
  position: absolute;
  top: 6.5%;
  display: inline-flex;
  align-items: center;
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  z-index: 3;
  white-space: nowrap;
}
.kp-eyebrow__line {
  display: inline-block;
  width: 22px; height: 1px;
  background: var(--ink-4);
  margin-right: 10px;
}
.kp-eyebrow--idx { left: 50%; transform: translateX(-50%); }

/* SVG flow layer */
.kp-svg {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  z-index: 1;
  overflow: visible;
  pointer-events: none;
}

/* Source + consumer cards */
.kp-card {
  position: absolute;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--panel) 88%, transparent);
  border: 1px solid var(--line-2);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  box-shadow: 0 1px 2px oklch(0.2 0.02 285 / 0.04);
  z-index: 2;
  box-sizing: border-box;
  transition: box-shadow 240ms ease, border-color 240ms ease;
}
.kp-card__icon {
  width: 28px; height: 28px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: var(--bg);
  border: 1px solid var(--line-2);
}
.kp-card__icon svg { width: 16px; height: 16px; display: block; }
.kp-card__text { min-width: 0; }
.kp-card__label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kp-card__meta {
  font-size: 10px;
  color: var(--ink-3);
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  margin-top: 2px;
  letter-spacing: 0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kp-card__pulse {
  position: absolute; inset: -2px;
  border-radius: 14px;
  border: 1px solid transparent;
  pointer-events: none;
  opacity: 0;
  transition: opacity 240ms ease;
}
.kp-card--active .kp-card__pulse {
  opacity: 1;
  border-color: var(--accent);
  box-shadow:
    0 0 0 4px color-mix(in oklch, var(--accent) 18%, transparent),
    0 0 24px color-mix(in oklch, var(--accent) 35%, transparent);
  animation: kp-pulse 0.8s ease-out;
}
@keyframes kp-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.04); }
  100% { transform: scale(1); }
}

/* Embeddings card sits below the graph hub */
.kp-embed {
  position: absolute;
  left: 50%;
  top: 72%;
  transform: translateX(-50%);
  width: clamp(220px, 26%, 360px);
  padding: 12px 16px;
  border-radius: 14px;
  background: color-mix(in oklch, var(--panel) 84%, transparent);
  border: 1px solid var(--line-2);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  z-index: 2;
}
.kp-embed__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
.kp-embed__title {
  font-size: 12px;
  font-weight: 500;
  color: var(--ink);
}
.kp-embed__meta {
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  font-size: 10px;
  color: var(--ink-3);
  letter-spacing: 0.04em;
}
.kp-embed__bars {
  display: grid;
  grid-template-columns: repeat(24, 1fr);
  gap: 2px;
  height: 36px;
  align-items: end;
}
.kp-embed__bar {
  background: linear-gradient(to top, var(--accent), oklch(0.7 0.22 285));
  border-radius: 1px;
}

/* Bottom title block — design's caption */
.kp-title {
  position: absolute;
  left: 50%;
  bottom: 4%;
  transform: translateX(-50%);
  text-align: center;
  z-index: 3;
  pointer-events: none;
}
.kp-title__head {
  margin: 0;
  font-size: clamp(20px, 2.4vw, 28px);
  font-weight: 500;
  letter-spacing: -0.02em;
  color: var(--ink);
}
.kp-title__head em {
  font-family: var(--font-instrument-serif, 'Instrument Serif', Georgia, serif);
  font-style: italic;
  font-weight: 400;
}
.kp-title__sub {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--ink-3);
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  letter-spacing: 0.04em;
}

/* Reduced motion — freeze ambient + pulse */
@media (prefers-reduced-motion: reduce) {
  .kp-orb-a, .kp-orb-b, .kp-orb-c { animation: none; }
  .kp-card--active .kp-card__pulse { animation: none; }
}

/* Mobile — keep the proportions; just shrink the card text and embed */
@media (max-width: 820px) {
  .kp-stage { max-width: 100%; margin: 32px 0 0; border-radius: 16px; }
  .kp-card { gap: 6px; padding: 5px 7px; border-radius: 8px; }
  .kp-card__icon { width: 20px; height: 20px; border-radius: 5px; }
  .kp-card__icon svg { width: 12px; height: 12px; }
  .kp-card__label { font-size: 9px; }
  .kp-card__meta { font-size: 7px; margin-top: 1px; }
  .kp-embed { padding: 6px 8px; border-radius: 8px; }
  .kp-embed__title { font-size: 9px; }
  .kp-embed__meta { font-size: 7px; }
  .kp-embed__bars { height: 20px; }
  .kp-eyebrow { font-size: 8px; letter-spacing: 0.1em; }
  .kp-eyebrow__line { width: 10px; margin-right: 5px; }
  .kp-title__head { font-size: 16px; }
  .kp-title__sub { font-size: 9px; }
}
`;

function Stats() {
  const items = [
    { num: '12+', label: 'Document types' },
    { num: '<2s', label: 'Response time' },
    { num: '99%', label: 'AI accuracy' },
    { num: '5k+', label: 'Docs analyzed' },
  ];
  return (
    <div className={styles.statsStrip}>
      <div className={styles.statsGrid}>
        {items.map((s) => (
          <div key={s.label} className={styles.statItem}>
            <div className={styles.statNum}>{s.num}</div>
            <div className={styles.statLabel}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Problem() {
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>The problem</div>
        <h2 className={styles.h2}>
          Your best thinking is <span className={styles.serif}>stranded</span>{' '}
          across eight apps.
        </h2>
        <p className={styles.lead}>
          You took the meeting. You saved the PDF. You wrote the Notion doc.
          But when you need to answer &ldquo;what did our users actually care
          about?&rdquo; — it&rsquo;s buried. Launchstack fixes the last mile.
        </p>

        <div className={styles.problemGrid}>
          <div className={`${styles.pcard} ${styles.pcardBad}`}>
            <h3>Without Launchstack</h3>
            {[
              'Open 6 tabs just to answer one question',
              'Re-listen to calls because search can\u2019t find audio',
              'Gmail threads forgotten after two weeks',
              'ChatGPT hallucinates — it doesn\u2019t know your context',
            ].map((t) => (
              <div key={t} className={styles.prow}>
                <span className={`${styles.icon} ${styles.iconBad}`}>×</span>
                {t}
              </div>
            ))}
          </div>
          <div className={styles.pcard}>
            <h3>With Launchstack</h3>
            {[
              'One place for files, recordings, docs, and inboxes',
              'Transcription + search across every mp3 and mp4',
              'Gmail & Notion sync live — not a one-shot import',
              'Cited answers — click the chip, see the exact paragraph',
            ].map((t) => (
              <div key={t} className={styles.prow}>
                <span className={`${styles.icon} ${styles.iconGood}`}>✓</span>
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Sources() {
  const [tab, setTab] = useState<'connectors' | 'formats'>('connectors');
  return (
    <section id="features" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>Everything plugs in</div>
        <h2 className={styles.h2}>
          If it has <span className={styles.serif}>words, sound, or pixels,</span>{' '}
          Launchstack reads it.
        </h2>
        <p className={styles.lead}>
          Connect the apps where your thinking already lives. Drag in files of
          almost any format — we handle transcription, OCR, and chunking
          automatically.
        </p>

        <div style={sourcesShellInline}>
          <div style={sourcesTabsInline}>
            <button
              onClick={() => setTab('connectors')}
              style={sourcesTab(tab === 'connectors')}
            >
              <Link2 size={14} />
              Connectors <span style={countStyle(tab === 'connectors')}>{CONNECTORS.length}</span>
            </button>
            <button
              onClick={() => setTab('formats')}
              style={sourcesTab(tab === 'formats')}
            >
              <FileText size={14} />
              File formats <span style={countStyle(tab === 'formats')}>{FORMATS.length}+</span>
            </button>
          </div>
          <div style={{ padding: 24 }}>
            {tab === 'connectors' ? (
              <div style={connGridInline}>
                {CONNECTORS.map((c) => (
                  <div key={c.name} style={connStyle}>
                    <div style={connLogoStyle}>
                      <Sparkles size={20} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.45 }}>
                      {c.desc}
                    </div>
                    <span style={connTagStyle(!!c.soon)}>{c.tag}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={fmtGridInline}>
                {FORMATS.map((f) => (
                  <div key={f.ext} style={fmtStyle}>
                    <span style={fmtExtStyle(f.kind)}>{f.ext}</span>
                    <span style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.35 }}>
                      {f.name}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const sourcesShellInline: React.CSSProperties = {
  marginTop: 32,
  borderRadius: 22,
  background: 'var(--panel)',
  border: '1px solid var(--line-2)',
  overflow: 'hidden',
};
const sourcesTabsInline: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  padding: '14px 18px 0',
  borderBottom: '1px solid var(--line-2)',
};
const sourcesTab = (active: boolean): React.CSSProperties => ({
  appearance: 'none',
  background: 'transparent',
  border: 0,
  cursor: 'pointer',
  color: active ? 'var(--ink)' : 'var(--ink-3)',
  padding: '10px 14px 14px',
  fontSize: 14,
  fontWeight: 500,
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  marginBottom: -1,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontFamily: 'inherit',
});
const countStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 11,
  padding: '1px 7px',
  borderRadius: 999,
  background: active ? 'var(--accent-soft)' : 'var(--panel-2)',
  color: active ? 'var(--accent-ink)' : 'var(--ink-3)',
  fontFamily: 'var(--font-jetbrains-mono, monospace)',
  fontWeight: 500,
});
const connGridInline: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(4, 1fr)',
  gap: 12,
};
const connStyle: React.CSSProperties = {
  position: 'relative',
  padding: '18px 16px',
  borderRadius: 14,
  background: 'var(--bg-2)',
  border: '1px solid var(--line-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  transition: 'all .2s',
};
const connLogoStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  borderRadius: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--panel)',
  border: '1px solid var(--line-2)',
  color: 'var(--accent)',
};
const connTagStyle = (soon: boolean): React.CSSProperties => ({
  position: 'absolute',
  top: 12,
  right: 12,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.04em',
  padding: '2px 7px',
  borderRadius: 999,
  background: soon ? 'oklch(0.96 0.005 280)' : 'var(--accent-soft)',
  color: soon ? 'var(--ink-3)' : 'var(--accent-ink)',
  textTransform: 'uppercase',
});
const fmtGridInline: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(6, 1fr)',
  gap: 10,
};
const fmtStyle: React.CSSProperties = {
  aspectRatio: '1 / 0.9',
  borderRadius: 12,
  background: 'var(--bg-2)',
  border: '1px solid var(--line-2)',
  padding: '12px 10px',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'space-between',
};
const KIND_COLORS = {
  doc: { c: 'oklch(0.45 0.18 255)', bg: 'oklch(0.97 0.03 255)' },
  audio: { c: 'oklch(0.45 0.22 30)', bg: 'oklch(0.96 0.04 30)' },
  video: { c: 'oklch(0.45 0.22 0)', bg: 'oklch(0.96 0.04 0)' },
  image: { c: 'oklch(0.45 0.18 150)', bg: 'oklch(0.96 0.05 150)' },
  code: { c: 'oklch(0.45 0.20 285)', bg: 'oklch(0.96 0.04 285)' },
  data: { c: 'oklch(0.45 0.18 80)', bg: 'oklch(0.96 0.05 80)' },
};
const fmtExtStyle = (kind: keyof typeof KIND_COLORS): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  fontFamily: 'var(--font-jetbrains-mono, monospace)',
  fontSize: 11,
  fontWeight: 600,
  padding: '3px 7px',
  borderRadius: 5,
  background: KIND_COLORS[kind].bg,
  border: `1px solid ${KIND_COLORS[kind].c}40`,
  color: KIND_COLORS[kind].c,
  letterSpacing: '0.02em',
  alignSelf: 'flex-start',
});

function HowItWorks() {
  const steps = [
    { n: '01', title: 'Drop everything in', desc: 'Drag a folder, paste a URL, upload a call recording, or click one button to connect Gmail and Notion. Launchstack handles transcription and indexing.' },
    { n: '02', title: 'Check what matters', desc: 'Your sources appear in a clean rail. Tick the ones you want in scope for this question. Leave the rest alone.' },
    { n: '03', title: 'Ask. Get cited answers.', desc: 'Type your question in plain English. Launchstack synthesizes across every checked source — and every claim links to the exact paragraph or timestamp.' },
  ];
  return (
    <section id="how" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>How it works</div>
        <h2 className={styles.h2}>
          Three steps. <span className={styles.serif}>Zero setup.</span>
        </h2>
        <p className={styles.lead}>
          Drop in, check what matters, ask. The hero above is the actual
          product.
        </p>

        <div className={styles.workflows}>
          {steps.map((s) => (
            <div key={s.n} className={styles.workflow}>
              <div className={styles.workflowNum}>{s.n}</div>
              <h4>{s.title}</h4>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  const list = [
    {
      quote:
        'Launchstack replaced a stack of tools in an afternoon. Being able to see which PDFs go into the context is the feature I didn\u2019t know I needed.',
      name: 'Anonymous',
      role: 'Founder',
      initials: 'AF',
    },
    {
      quote:
        'I run dozens of user interviews a month. Transcription, batch Q&A, and timestamped quotes all in one place has been a huge time-saver.',
      name: 'Anonymous',
      role: 'Developer',
      initials: 'AD',
    },
    {
      quote:
        'The graph view is what sold me. I didn\u2019t realize how much of my thinking lives in the connections between docs until I could see them.',
      name: 'Anonymous',
      role: 'Solo founder',
      initials: 'SF',
    },
  ];
  return (
    <section className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>Loved by builders</div>
        <h2 className={styles.h2}>
          Used by <span className={styles.serif}>founders and developers.</span>
        </h2>

        <div className={styles.testimonials}>
          {list.map((t) => (
            <div key={t.initials} className={styles.testi}>
              <blockquote>{t.quote}</blockquote>
              <div className={styles.testiWho}>
                <div className={styles.testiAvatar}>{t.initials}</div>
                <div>
                  <div className={styles.testiName}>{t.name}</div>
                  <div className={styles.testiRole}>{t.role}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section id="pricing" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>Pricing</div>
        <h2 className={styles.h2}>
          Free to start. <span className={styles.serif}>Pay when your brain grows.</span>
        </h2>
        <p className={styles.lead}>
          No seats, no per-source fees. Your library stays yours — export
          anytime.
        </p>

        <div className={styles.pricingGrid}>
          <PriceCard
            name="Free"
            amount="$0"
            per="/mo"
            tagline="For individuals exploring."
            features={[
              'Up to 100 sources',
              '2 hours of transcription/mo',
              '1 connector (Gmail OR Notion)',
              'Cited answers',
            ]}
            cta="Start free"
            href="/signup"
            variant="outline"
          />
          <PriceCard
            name="Pro"
            amount="$18"
            per="/mo"
            tagline="For founders & researchers."
            badge="MOST LOVED"
            featured
            features={[
              'Unlimited sources',
              '20 hours of transcription/mo',
              'All connectors, live sync',
              'Graph view, version history',
              'Priority models',
            ]}
            cta="Start 14-day trial"
            href="/signup"
            variant="accent"
          />
          <PriceCard
            name="Team"
            amount="$14"
            per="/seat/mo"
            tagline="For small teams that share sources."
            features={[
              'Everything in Pro',
              'Shared workspaces & tags',
              'Per-source permissions',
            ]}
            cta="Contact us"
            href="/contact"
            variant="outline"
          />
        </div>
      </div>
    </section>
  );
}

function PriceCard({
  name,
  amount,
  per,
  tagline,
  features,
  cta,
  href,
  variant,
  featured,
  badge,
}: {
  name: string;
  amount: string;
  per: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  variant: 'accent' | 'outline';
  featured?: boolean;
  badge?: string;
}) {
  return (
    <div className={`${styles.price} ${featured ? styles.priceFeatured : ''}`}>
      {badge && <span className={styles.priceBadge}>{badge}</span>}
      <h3>{name}</h3>
      <div className={styles.priceAmount}>
        {amount}
        <span>{per}</span>
      </div>
      <p className={styles.priceTagline}>{tagline}</p>
      <ul>
        {features.map((f) => (
          <li key={f}>
            <Check size={14} />
            {f}
          </li>
        ))}
      </ul>
      <Link
        href={href}
        className={`${styles.btn} ${variant === 'accent' ? styles.btnAccent : styles.btnOutline}`}
      >
        {cta}
      </Link>
    </div>
  );
}

function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>Questions</div>
        <h2 className={styles.h2}>Everything else.</h2>
        <div className={styles.faq}>
          {FAQS.map((f, i) => (
            <div
              key={f.q}
              className={`${styles.faqItem} ${open === i ? styles.faqItemOpen : ''}`}
            >
              <div className={styles.faqQ} onClick={() => setOpen(open === i ? null : i)}>
                {f.q}
                <Plus size={18} />
              </div>
              <div className={styles.faqA}>{f.a}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OpenSource() {
  return (
    <section id="oss" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.oss}>
          <div>
            <div className={styles.ossEyebrow}>
              <Github size={14} />
              Built in the open
            </div>
            <h3>
              The engine is <span className={styles.serif}>open source.</span>{' '}
              Read it. Fork it. Run it.
            </h3>
            <p>
              The core retrieval pipeline — chunking, embedding, graph
              construction, and cited synthesis — lives on GitHub under Apache 2.0.
              Audit the prompts, swap the model, self-host the whole thing. We
              keep the hosted app polished so you don&rsquo;t have to; but the
              brain is yours either way.
            </p>
            <div className={styles.ossCtas}>
              <a
                className={`${styles.btn} ${styles.btnAccent}`}
                href={GITHUB_REPO}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Github size={16} />
                View on GitHub
              </a>
              <Link href="/deployment" className={`${styles.btn} ${styles.btnOutline}`}>
                <Terminal size={16} />
                Self-host guide
              </Link>
            </div>
          </div>
          <div className={styles.ossCard} aria-hidden>
            <div className={styles.ossCardHd}>
              <Github size={14} />
              <span className="repo" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                Deodat-Lawson
              </span>
              <span className="slash" style={{ color: 'var(--ink-4)' }}>/</span>
              <span className="repo" style={{ fontWeight: 600, color: 'var(--ink)' }}>
                pdr_ai_v2
              </span>
              <span
                className="star"
                style={{
                  marginLeft: 'auto',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'var(--panel-2)',
                  color: 'var(--ink-2)',
                  fontSize: 11,
                }}
              >
                ★ 1,412
              </span>
            </div>
            <div className={styles.ossTree}>
              <TreeRow name="core/" comment="the brain" />
              <TreeRow name="chunker.py" comment="semantic splits" nested />
              <TreeRow name="embed.py" comment="pluggable models" nested />
              <TreeRow name="graph.py" comment="link discovery" nested />
              <TreeRow name="synthesize.py" comment="cited answers" nested />
              <TreeRow name="connectors/" comment="12 adapters" />
              <TreeRow name="LICENSE" comment="Apache 2.0" />
              <TreeRow name="README.md" comment="start here" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function TreeRow({ name, comment, nested }: { name: string; comment: string; nested?: boolean }) {
  return (
    <div className={`row ${nested ? styles.rowNested : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: nested ? 16 : 0 }}>
      <span style={{ color: 'var(--ink)' }} className="name">
        {name}
      </span>
      <span className="comment" style={{ color: 'var(--ink-3)', marginLeft: 'auto', fontSize: 11 }}>
        {comment}
      </span>
    </div>
  );
}

function FinalCta() {
  return (
    <div className={styles.finalCta}>
      <div className={styles.eyebrow} style={{ justifyContent: 'center', display: 'inline-flex' }}>
        Start your brain
      </div>
      <h2 className={styles.h2}>
        It takes <span className={styles.serif}>90 seconds</span> to feel the
        difference.
      </h2>
      <p>
        Drop in 10 sources, ask one question, watch it answer with citations.
        If it doesn&rsquo;t click, close the tab — we&rsquo;ll delete your data
        automatically.
      </p>
      <div className={styles.heroCtas}>
        <Link href="/signup" className={`${styles.btn} ${styles.btnAccent} ${styles.btnLg}`}>
          Start free — no card needed
        </Link>
        <Link href="/deployment" className={`${styles.btn} ${styles.btnOutline} ${styles.btnLg}`}>
          Read the docs
        </Link>
      </div>
    </div>
  );
}
