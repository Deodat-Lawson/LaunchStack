'use client';

import Link from 'next/link';
import React, { useEffect, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import {
  ArrowRight,
  Bot,
  Check,
  FileText,
  FileType,
  Github,
  Link2,
  Mail,
  Mic,
  Play,
  Plus,
  Sparkles,
  Terminal,
  Workflow,
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
    a: `Yes — the retrieval core (chunking, embeddings, graph, cited synthesis) is MIT-licensed on GitHub. The hosted app adds the polished UI, connectors, and billing — you can skip all of that and run the engine yourself.`,
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
          Free, MIT-licensed, self-hostable →
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
          <span>MIT licensed</span>
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
// Recreates the Drift "knowledge-pipeline" animation spec:
// sources (Gmail, Notion, PDFs, Audio, GitHub) → knowledge graph +
// embeddings → consumers (OpenAI, Anthropic, Claude Code, n8n).

const PIPE_SOURCES = [
  { Icon: Mail,     label: 'Gmail',  meta: '12,408 threads' },
  { Icon: FileText, label: 'Notion', meta: '842 pages' },
  { Icon: FileType, label: 'PDFs',   meta: '193 files' },
  { Icon: Mic,      label: 'Audio',  meta: '76 calls' },
  { Icon: Github,   label: 'GitHub', meta: '38 repos' },
];

const PIPE_CONSUMERS = [
  { Icon: Sparkles, label: 'OpenAI',      meta: 'GPT-4o' },
  { Icon: Bot,      label: 'Anthropic',   meta: 'Claude 4' },
  { Icon: Terminal, label: 'Claude Code', meta: 'CLI & IDE' },
  { Icon: Workflow, label: 'n8n',         meta: 'Workflows' },
];

// viewBox: 0 0 120 70. Cards sit in 22%-wide columns at the edges; paths
// emit from x=26.4 (22% of 120) and arrive at x=93.6 (78% of 120).
const KP_VB_W = 120;
const KP_VB_H = 70;
const KP_LEFT_EDGE = 26.4;
const KP_RIGHT_EDGE = 93.6;
const KP_GRAPH = { cx: 60, cy: 26 };
const KP_EMB_Y = 54;
const SOURCE_YS   = [10.5, 22.75, 35, 47.25, 59.5];
const SOURCE_TOPS = ['15%', '32.5%', '50%', '67.5%', '85%'];
const CONSUMER_YS   = [10.64, 26.88, 43.12, 59.36];
const CONSUMER_TOPS = ['15.2%', '38.4%', '61.6%', '84.8%'];

function KnowledgePipeline() {
  return (
    <section id="pipeline" className={styles.section}>
      <div className={styles.container}>
        <div className={styles.eyebrow}>The pipeline</div>
        <h2 className={styles.h2}>
          Your data,{' '}
          <span className={styles.serif}>indexed</span>, queryable.
        </h2>
        <p className={styles.lead}>
          Gmail threads, Notion pages, PDFs, call recordings, and your GitHub
          repos stream into one living knowledge graph. Embeddings index
          meaning — not just keywords — so every LLM, agent, and workflow
          queries the same brain, with citations, every time.
        </p>

        <div className="kp-stage" role="img" aria-label="Sources flow into a knowledge graph with embeddings, then out to LLMs, agents, and workflows.">
          <style>{KP_CSS}</style>

          <div className="kp-ambient" aria-hidden>
            <div className="kp-orb kp-orb1" />
            <div className="kp-orb kp-orb2" />
            <div className="kp-orb kp-orb3" />
            <div className="kp-dots" />
          </div>

          <div className="kp-colLabel kp-colLabelL">Sources</div>
          <div className="kp-colLabel kp-colLabelR">Consumers</div>

          <svg
            className="kp-svg"
            viewBox={`0 0 ${KP_VB_W} ${KP_VB_H}`}
            preserveAspectRatio="none"
            aria-hidden
          >
            <defs>
              {SOURCE_YS.map((y, i) => (
                <path
                  key={`inp${i}`}
                  id={`kp-in-${i}`}
                  d={`M ${KP_LEFT_EDGE} ${y} C ${KP_LEFT_EDGE + 16} ${y}, ${KP_GRAPH.cx - 10} ${KP_GRAPH.cy}, ${KP_GRAPH.cx} ${KP_GRAPH.cy}`}
                />
              ))}
              {CONSUMER_YS.map((y, i) => (
                <path
                  key={`outp${i}`}
                  id={`kp-out-${i}`}
                  d={`M ${KP_GRAPH.cx + 20} ${KP_EMB_Y} C ${KP_GRAPH.cx + 26} ${KP_EMB_Y}, ${KP_RIGHT_EDGE - 8} ${y}, ${KP_RIGHT_EDGE} ${y}`}
                />
              ))}
            </defs>

            {SOURCE_YS.map((_, i) => (
              <use key={`use-in-${i}`} href={`#kp-in-${i}`} className="kp-line" />
            ))}
            {CONSUMER_YS.map((_, i) => (
              <use key={`use-out-${i}`} href={`#kp-out-${i}`} className="kp-line" />
            ))}

            <KnowledgeGraph cx={KP_GRAPH.cx} cy={KP_GRAPH.cy} />
            <EmbeddingsRow cx={KP_GRAPH.cx} cy={KP_EMB_Y} />

            {SOURCE_YS.map((_, i) => {
              const stagger = i * 0.35;
              return [0, 1, 2].map((k) => {
                const begin = `${stagger + k * 1.07}s`;
                return (
                  <circle key={`pin${i}-${k}`} r={0.75} className="kp-dot kp-dotV" opacity={0}>
                    <animateMotion dur="3.2s" begin={begin} repeatCount="indefinite">
                      <mpath href={`#kp-in-${i}`} />
                    </animateMotion>
                    <animate
                      attributeName="opacity"
                      values="0;1;1;0"
                      keyTimes="0;0.1;0.9;1"
                      dur="3.2s"
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </circle>
                );
              });
            })}

            {CONSUMER_YS.map((_, i) => {
              const stagger = 4 + i * 0.5;
              return [0, 1, 2].map((k) => {
                const begin = `${stagger + k * 1.17}s`;
                return (
                  <circle key={`pout${i}-${k}`} r={0.75} className="kp-dot kp-dotM" opacity={0}>
                    <animateMotion dur="3.5s" begin={begin} repeatCount="indefinite">
                      <mpath href={`#kp-out-${i}`} />
                    </animateMotion>
                    <animate
                      attributeName="opacity"
                      values="0;1;1;0"
                      keyTimes="0;0.1;0.9;1"
                      dur="3.5s"
                      begin={begin}
                      repeatCount="indefinite"
                    />
                  </circle>
                );
              });
            })}
          </svg>

          {PIPE_SOURCES.map((s, i) => (
            <PipeCard
              key={s.label}
              side="left"
              top={SOURCE_TOPS[i]!}
              delay={`${i * 0.35}s`}
              Icon={s.Icon}
              label={s.label}
              meta={s.meta}
            />
          ))}

          {PIPE_CONSUMERS.map((c, i) => (
            <PipeCard
              key={c.label}
              side="right"
              top={CONSUMER_TOPS[i]!}
              delay={`${4 + i * 0.5}s`}
              Icon={c.Icon}
              label={c.label}
              meta={c.meta}
            />
          ))}

          <div className="kp-coreLabel">
            <div className="kp-coreLabelTitle">Knowledge graph</div>
            <div className="kp-coreLabelSub">29 nodes · live index</div>
          </div>
          <div className="kp-embLabel">
            Embeddings <span className="kp-embLabelMono">· 1,536-dim</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PipeCard({
  side,
  top,
  delay,
  Icon,
  label,
  meta,
}: {
  side: 'left' | 'right';
  top: string;
  delay: string;
  Icon: React.ComponentType<{ size?: number }>;
  label: string;
  meta: string;
}) {
  return (
    <div
      className={`kp-card ${side === 'left' ? 'kp-cardL' : 'kp-cardR'}`}
      style={{ top, animationDelay: delay }}
    >
      <span className="kp-cardIco">
        <Icon size={14} />
      </span>
      <div className="kp-cardText">
        <div className="kp-cardName">{label}</div>
        <div className="kp-cardMeta">{meta}</div>
      </div>
      <span className="kp-cardPulse" style={{ animationDelay: delay }} aria-hidden />
    </div>
  );
}

function KnowledgeGraph({ cx, cy }: { cx: number; cy: number }) {
  const RING1 = 6;
  const RING2 = 8;
  const nodes: Array<{ x: number; y: number; r: number; primary?: boolean; delay: number }> = [
    { x: cx, y: cy, r: 2.2, primary: true, delay: 0 },
  ];
  for (let i = 0; i < RING1; i++) {
    const a = (i / RING1) * Math.PI * 2 - Math.PI / 2;
    nodes.push({ x: cx + Math.cos(a) * 7, y: cy + Math.sin(a) * 5.5, r: 0.95, delay: 0.2 + i * 0.15 });
  }
  for (let i = 0; i < RING2; i++) {
    const a = (i / RING2) * Math.PI * 2 - Math.PI / 3;
    nodes.push({ x: cx + Math.cos(a) * 13, y: cy + Math.sin(a) * 9.5, r: 0.7, delay: 1.2 + i * 0.13 });
  }
  const edges: Array<[number, number]> = [];
  for (let i = 1; i <= RING1; i++) edges.push([0, i]);
  for (let i = 1; i <= RING1; i++) edges.push([i, 1 + (i % RING1)]);
  for (let j = 0; j < RING2; j++) {
    const inner = 1 + (j % RING1);
    edges.push([inner, 1 + RING1 + j]);
  }
  return (
    <g className="kp-graph">
      {edges.map(([a, b], i) => (
        <line
          key={`edg${i}`}
          x1={nodes[a]!.x}
          y1={nodes[a]!.y}
          x2={nodes[b]!.x}
          y2={nodes[b]!.y}
          style={{ animationDelay: `${(i % 8) * 0.2}s` }}
        />
      ))}
      {nodes.map((n, i) => (
        <circle
          key={`nd${i}`}
          cx={n.x}
          cy={n.y}
          r={n.r}
          className={n.primary ? 'kp-node kp-nodeCore' : 'kp-node'}
          style={{ animationDelay: `${n.delay}s` }}
        />
      ))}
    </g>
  );
}

function EmbeddingsRow({ cx, cy }: { cx: number; cy: number }) {
  const COUNT = 24;
  const W = 34;
  const H = 9;
  const x0 = cx - W / 2;
  const y0 = cy - H / 2;
  const barW = 0.85;
  const step = (W - 2) / COUNT;
  return (
    <g className="kp-emb">
      <rect x={x0} y={y0} width={W} height={H} rx={1.5} className="kp-embFrame" />
      {Array.from({ length: COUNT }, (_, i) => {
        const x = x0 + 1 + i * step;
        const delay = (i * 0.08) % 2;
        return (
          <rect
            key={i}
            className="kp-embBar"
            x={x}
            y={y0 + 1}
            width={barW}
            height={H - 2}
            rx={0.3}
            style={{ animationDelay: `${delay}s` }}
          />
        );
      })}
    </g>
  );
}

const KP_CSS = `
.kp-stage {
  position: relative;
  width: 100%;
  max-width: 1180px;
  margin: 40px auto 0;
  aspect-ratio: 12 / 7;
  border-radius: 22px;
  background:
    radial-gradient(ellipse at 50% 40%, oklch(from var(--accent) l c h / 0.05) 0%, transparent 70%),
    linear-gradient(180deg, var(--panel) 0%, var(--bg-2) 100%);
  border: 1px solid var(--line-2);
  box-shadow: 0 40px 80px oklch(0 0 0 / 0.08), 0 8px 24px oklch(0 0 0 / 0.04);
  overflow: hidden;
  isolation: isolate;
}
:global(.dark) .kp-stage,
:global([data-theme="dark"]) .kp-stage {
  background:
    radial-gradient(ellipse at 50% 40%, oklch(0.72 0.19 285 / 0.08) 0%, transparent 70%),
    linear-gradient(180deg, var(--panel) 0%, var(--bg-2) 100%);
  box-shadow: 0 40px 100px oklch(0 0 0 / 0.5);
}

/* ambient — quieter orbs so the flow reads as the hero */
.kp-ambient { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.kp-orb {
  position: absolute; border-radius: 50%;
  filter: blur(80px); opacity: 0.55;
  mix-blend-mode: plus-lighter;
  will-change: transform;
}
.kp-orb1 {
  width: 520px; height: 520px; left: -80px; top: -120px;
  background: radial-gradient(circle at 50% 50%,
    oklch(from var(--accent) l c h / 0.55) 0%,
    oklch(from var(--accent) l c h / 0) 65%);
  animation: kp-drift1 32s ease-in-out infinite alternate;
}
.kp-orb2 {
  width: 640px; height: 640px; right: -140px; top: 40px;
  background: radial-gradient(circle at 50% 50%,
    oklch(0.68 0.22 340 / 0.45) 0%,
    oklch(0.68 0.22 340 / 0) 65%);
  animation: kp-drift2 38s ease-in-out infinite alternate;
}
.kp-orb3 {
  width: 520px; height: 520px; left: 30%; bottom: -180px;
  background: radial-gradient(circle at 50% 50%,
    oklch(0.72 0.16 200 / 0.45) 0%,
    oklch(0.72 0.16 200 / 0) 65%);
  animation: kp-drift3 26s ease-in-out infinite alternate;
}
.kp-dots {
  position: absolute; inset: 0;
  background-image: radial-gradient(oklch(0 0 0 / 0.35) 1px, transparent 1px);
  background-size: 28px 28px;
  -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 40%, #000 0%, transparent 85%);
          mask-image: radial-gradient(ellipse 60% 50% at 50% 40%, #000 0%, transparent 85%);
  opacity: 0.18;
}
@keyframes kp-drift1 {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(60px, 40px) scale(1.08); }
}
@keyframes kp-drift2 {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(-80px, 50px) scale(0.95); }
}
@keyframes kp-drift3 {
  0% { transform: translate(0, 0) scale(1); }
  100% { transform: translate(30px, -40px) scale(1.05); }
}

/* column labels — editorial eyebrow style from the Drift brief */
.kp-colLabel {
  position: absolute;
  top: 20px;
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink-3);
  z-index: 3;
}
.kp-colLabelL { left: calc(2% + 12px); }
.kp-colLabelR { right: calc(2% + 12px); }

/* SVG flow layer */
.kp-svg {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  z-index: 1;
  overflow: visible;
}
.kp-line {
  fill: none;
  stroke: oklch(from var(--accent) l c h / 0.22);
  stroke-width: 0.3;
  stroke-linecap: round;
}

/* particles */
.kp-dot { filter: drop-shadow(0 0 0.8px currentColor); }
.kp-dotV { fill: oklch(from var(--accent) l c h / 1); color: oklch(from var(--accent) l c h / 0.9); }
.kp-dotM { fill: oklch(0.66 0.22 340); color: oklch(0.66 0.22 340); }

/* graph + embeddings */
.kp-graph line {
  stroke: oklch(from var(--accent) l c h / 0.4);
  stroke-width: 0.25;
  animation: kp-edgePulse 3.2s ease-in-out infinite;
}
@keyframes kp-edgePulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.85; }
}
.kp-node {
  fill: var(--panel);
  stroke: var(--accent);
  stroke-width: 0.28;
  transform-origin: center;
  transform-box: fill-box;
  animation: kp-nodePulse 2.8s ease-in-out infinite;
}
.kp-nodeCore {
  fill: var(--accent);
  stroke: var(--panel);
  stroke-width: 0.35;
  animation: kp-corePulse 2.4s ease-in-out infinite;
}
@keyframes kp-nodePulse {
  0%, 100% { opacity: 0.8; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.18); }
}
@keyframes kp-corePulse {
  0%, 100% { transform: scale(1); filter: brightness(1); }
  50% { transform: scale(1.12); filter: brightness(1.25); }
}
.kp-embFrame {
  fill: oklch(from var(--panel) l c h / 0.6);
  stroke: var(--line-2);
  stroke-width: 0.2;
}
.kp-embBar {
  fill: oklch(0.66 0.22 340 / 0.75);
  transform-origin: center bottom;
  transform-box: fill-box;
  animation: kp-embShimmer 2.2s ease-in-out infinite;
}
@keyframes kp-embShimmer {
  0%, 100% { transform: scaleY(0.35); opacity: 0.55; }
  50%      { transform: scaleY(1);    opacity: 1; }
}

/* core + embeddings text labels */
.kp-coreLabel {
  position: absolute;
  left: 50%;
  top: calc(26 / 70 * 100% - 38px);
  transform: translateX(-50%);
  text-align: center;
  z-index: 2;
  pointer-events: none;
}
.kp-coreLabelTitle {
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.kp-coreLabelSub {
  font-size: 10px;
  color: var(--ink-3);
  margin-top: 2px;
}
.kp-embLabel {
  position: absolute;
  left: 50%;
  top: calc(54 / 70 * 100% + 22px);
  transform: translateX(-50%);
  z-index: 2;
  text-align: center;
  font-size: 11px;
  color: var(--ink-2);
  pointer-events: none;
}
.kp-embLabelMono {
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  color: var(--ink-3);
}

/* source + consumer cards */
.kp-card {
  position: absolute;
  transform: translateY(-50%);
  width: 18%;
  min-width: 148px;
  display: flex; align-items: center; gap: 10px;
  padding: 9px 11px;
  border-radius: 12px;
  background: color-mix(in oklch, var(--panel) 85%, transparent);
  border: 1px solid var(--line-2);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 4px 14px oklch(0 0 0 / 0.06);
  animation: kp-cardPulse 3.2s ease-in-out infinite;
  z-index: 2;
}
.kp-cardL { left: 2%; }
.kp-cardR { right: 2%; }
.kp-cardIco {
  width: 26px; height: 26px; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px;
  background: oklch(from var(--accent) l c h / 0.12);
  color: var(--accent);
}
.kp-cardR .kp-cardIco {
  background: oklch(0.66 0.22 340 / 0.14);
  color: oklch(0.55 0.22 340);
}
:global(.dark) .kp-cardR .kp-cardIco,
:global([data-theme="dark"]) .kp-cardR .kp-cardIco {
  color: oklch(0.78 0.22 340);
}
.kp-cardText { min-width: 0; }
.kp-cardName {
  font-size: 12px; font-weight: 600; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.kp-cardMeta {
  font-size: 10px;
  color: var(--ink-3);
  font-family: var(--font-jetbrains-mono, ui-monospace, monospace);
  margin-top: 1px;
}
.kp-cardPulse {
  position: absolute; inset: -1px;
  border-radius: 12px; pointer-events: none;
  box-shadow: 0 0 0 0 oklch(from var(--accent) l c h / 0);
  animation: kp-ringPulse 3.2s ease-in-out infinite;
}
.kp-cardR .kp-cardPulse { animation-duration: 3.5s; }
@keyframes kp-cardPulse {
  0%, 100% { transform: translateY(-50%); }
  45%      { transform: translateY(calc(-50% - 2px)); }
}
@keyframes kp-ringPulse {
  0%, 70%, 100% { box-shadow: 0 0 0 0 oklch(from var(--accent) l c h / 0); }
  10% { box-shadow: 0 0 0 4px oklch(from var(--accent) l c h / 0.22); }
  20% { box-shadow: 0 0 0 10px oklch(from var(--accent) l c h / 0); }
}

/* reduced-motion: freeze ambient + pulses */
@media (prefers-reduced-motion: reduce) {
  .kp-orb1, .kp-orb2, .kp-orb3 { animation: none; }
  .kp-card, .kp-cardPulse, .kp-node, .kp-nodeCore, .kp-graph line, .kp-embBar {
    animation: none;
  }
  .kp-card { transform: translateY(-50%); }
}

/* mobile: collapse to a vertical stack */
@media (max-width: 820px) {
  .kp-stage { aspect-ratio: auto; height: auto; padding: 40px 16px 48px; }
  .kp-svg, .kp-coreLabel, .kp-embLabel, .kp-colLabel { display: none; }
  .kp-card {
    position: relative;
    top: auto !important;
    left: auto !important; right: auto !important;
    transform: none;
    width: 100%;
    min-width: 0;
    margin: 6px 0;
    animation: none;
  }
  .kp-card + .kp-card { margin-top: 6px; }
  .kp-ambient { opacity: 0.6; }
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
              construction, and cited synthesis — lives on GitHub under MIT.
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
              <TreeRow name="LICENSE" comment="MIT" />
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
