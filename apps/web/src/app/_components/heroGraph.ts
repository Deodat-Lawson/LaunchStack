// 2.5D knowledge-graph canvas simulation. Ported from the Claude Design
// bundle (launstack/project/hero-graph.js). Pure — no React, no deps.
// Projects 3D positions to 2D with perspective, edge springs, repulsion,
// cursor push, pulse/check indicators for scope + citation.

const TAU = Math.PI * 2;

type ClusterSeed = { id: string; label: string; cx: number; cy: number; cz: number; hue: number };
type NodeKind = 'audio' | 'mail' | 'notion' | 'pdf' | 'link' | 'doc';
type NodeSeed = { c: string; t: NodeKind; label: string; key: string };

const CLUSTERS: ClusterSeed[] = [
  { id: 'interviews',  label: 'Customer interviews', cx: -180, cy: -40,  cz:   0, hue: 285 },
  { id: 'competitors', label: 'Competitors',         cx:  170, cy:  60,  cz: -80, hue: 340 },
  { id: 'gmail',       label: 'Gmail · live',        cx: -100, cy: 150,  cz:  60, hue:  25 },
  { id: 'notion',      label: 'Notion · live',       cx:  100, cy: -160, cz:  40, hue: 210 },
  { id: 'drafts',      label: 'Drafts',              cx:  240, cy: -140, cz: -40, hue: 150 },
];

const NODE_SEED: NodeSeed[] = [
  { c: 'interviews', t: 'audio', label: 'Maya K. — Aug 14.mp3',    key: 'maya' },
  { c: 'interviews', t: 'audio', label: 'Jordan R. — Aug 16.mp3',  key: 'jordan' },
  { c: 'interviews', t: 'audio', label: 'Priya S. — Aug 18.mp3',   key: 'priya' },
  { c: 'interviews', t: 'doc',   label: 'Synthesis notes.md',      key: 'synth' },
  { c: 'interviews', t: 'doc',   label: 'Persona v3.pdf',          key: 'persona' },
  { c: 'interviews', t: 'audio', label: 'Ravi D. — Aug 20.mp3',    key: 'ravi' },

  { c: 'competitors', t: 'pdf',  label: 'Teardown — Linear.pdf',   key: 'linear' },
  { c: 'competitors', t: 'pdf',  label: 'Granola notes.pdf',       key: 'granola' },
  { c: 'competitors', t: 'link', label: 'Notion AI changelog',     key: 'notion-ai' },
  { c: 'competitors', t: 'pdf',  label: 'Mem.ai review.pdf',       key: 'mem' },
  { c: 'competitors', t: 'link', label: 'Superhuman pricing',      key: 'superhuman' },

  { c: 'gmail', t: 'mail', label: 'Investor thread — Emma C.',     key: 'emma' },
  { c: 'gmail', t: 'mail', label: 'Re: warm intro — Ravi',         key: 'warm' },
  { c: 'gmail', t: 'mail', label: 'Paulo S. — follow-up',          key: 'paulo' },
  { c: 'gmail', t: 'mail', label: 'Beta feedback digest',          key: 'digest' },
  { c: 'gmail', t: 'mail', label: 'Contract — signed',             key: 'contract' },

  { c: 'notion', t: 'notion', label: 'CRM — leads',                key: 'crm' },
  { c: 'notion', t: 'notion', label: 'Product roadmap Q4',         key: 'roadmap' },
  { c: 'notion', t: 'notion', label: 'Meeting notes — 08/14',      key: 'mn0814' },
  { c: 'notion', t: 'notion', label: 'Weekly review',              key: 'weekly' },

  { c: 'drafts', t: 'doc', label: 'Pricing page v7',               key: 'pricing' },
  { c: 'drafts', t: 'doc', label: 'Seed deck v4',                  key: 'deck' },
  { c: 'drafts', t: 'doc', label: 'Privacy headline A/B',          key: 'privacy' },
];

const EDGE_SEED: Array<[string, string]> = [
  ['maya', 'synth'], ['jordan', 'synth'], ['priya', 'synth'], ['ravi', 'synth'],
  ['maya', 'persona'], ['priya', 'persona'],
  ['maya', 'notion-ai'], ['jordan', 'linear'],
  ['emma', 'crm'], ['warm', 'ravi'], ['paulo', 'crm'],
  ['pricing', 'linear'], ['pricing', 'privacy'], ['pricing', 'synth'],
  ['deck', 'persona'], ['deck', 'digest'],
  ['crm', 'roadmap'], ['roadmap', 'weekly'], ['mn0814', 'weekly'],
  ['granola', 'linear'], ['mem', 'granola'], ['superhuman', 'linear'],
  ['digest', 'synth'],
];

export type GraphNode = {
  id: string;
  label: string;
  type: NodeKind;
  cluster: string;
  hue: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  ax: number; ay: number; az: number;
  sx: number; sy: number; scale: number; depth: number;
  radius: number;
  pulse: number;
  checked: boolean;
};

type Edge = { a: GraphNode; b: GraphNode };

type Graph = {
  nodes: GraphNode[];
  edges: Edge[];
  clusterMap: Record<string, ClusterSeed>;
  nodeById: Record<string, GraphNode>;
};

function createGraph(): Graph {
  const clusterMap: Record<string, ClusterSeed> = {};
  CLUSTERS.forEach(c => { clusterMap[c.id] = c; });

  const nodes: GraphNode[] = NODE_SEED.map((seed) => {
    const cluster = clusterMap[seed.c]!;
    const angle = Math.random() * TAU;
    const r = 60 + Math.random() * 40;
    return {
      id: seed.key,
      label: seed.label,
      type: seed.t,
      cluster: seed.c,
      hue: cluster.hue,
      x: cluster.cx + Math.cos(angle) * r,
      y: cluster.cy + Math.sin(angle) * r,
      z: cluster.cz + (Math.random() - 0.5) * 80,
      vx: 0, vy: 0, vz: 0,
      ax: 0, ay: 0, az: 0,
      sx: 0, sy: 0, scale: 1, depth: 0,
      radius: seed.t === 'audio' ? 7 : 5,
      pulse: 0,
      checked: false,
    };
  });

  const nodeById: Record<string, GraphNode> = {};
  nodes.forEach(n => { nodeById[n.id] = n; });

  const edges: Edge[] = EDGE_SEED
    .map(([a, b]) => ({ a: nodeById[a]!, b: nodeById[b]! }))
    .filter((e): e is Edge => !!e.a && !!e.b);

  return { nodes, edges, clusterMap, nodeById };
}

type Cursor = { sx: number; sy: number; wx: number; wy: number; active: boolean };

function step(graph: Graph, cursor: Cursor, dt: number) {
  const { nodes, edges, clusterMap } = graph;
  const repel = 120;
  const repelK = 8;
  const springK = 0.0008;
  const edgeRest = 110;
  const centerK = 0.0014;
  const damping = 0.86;

  for (const n of nodes) { n.ax = 0; n.ay = 0; n.az = 0; }

  for (const n of nodes) {
    const c = clusterMap[n.cluster]!;
    n.ax += (c.cx - n.x) * centerK;
    n.ay += (c.cy - n.y) * centerK;
    n.az += (c.cz - n.z) * centerK * 0.5;
  }

  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dz = (a.z - b.z) * 0.5;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < repel * repel && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = (repelK * (1 - d / repel)) / d;
        a.ax += dx * f; a.ay += dy * f; a.az += dz * f * 0.5;
        b.ax -= dx * f; b.ay -= dy * f; b.az -= dz * f * 0.5;
      }
    }
  }

  for (const e of edges) {
    const dx = e.b.x - e.a.x;
    const dy = e.b.y - e.a.y;
    const dz = e.b.z - e.a.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    const f = (d - edgeRest) * springK;
    const fx = (dx / d) * f;
    const fy = (dy / d) * f;
    const fz = (dz / d) * f;
    e.a.ax += fx; e.a.ay += fy; e.a.az += fz;
    e.b.ax -= fx; e.b.ay -= fy; e.b.az -= fz;
  }

  if (cursor.active) {
    const cx = cursor.wx;
    const cy = cursor.wy;
    const r = 140;
    const k = 80;
    for (const n of nodes) {
      const dx = n.x - cx;
      const dy = n.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = (k * (1 - d / r)) / d;
        n.ax += dx * f;
        n.ay += dy * f;
      }
    }
  }

  for (const n of nodes) {
    n.vx = (n.vx + n.ax * dt) * damping;
    n.vy = (n.vy + n.ay * dt) * damping;
    n.vz = (n.vz + n.az * dt) * damping;
    n.x += n.vx * dt;
    n.y += n.vy * dt;
    n.z += n.vz * dt;
    if (n.pulse > 0) n.pulse = Math.max(0, n.pulse - dt * 0.6);
  }
}

type Camera = { x: number; y: number; z: number; rotY: number; rotX: number; fov: number };

function project(node: GraphNode | { x: number; y: number; z: number; sx?: number; sy?: number; scale?: number; depth?: number }, cam: Camera, w: number, h: number) {
  const cosY = Math.cos(cam.rotY), sinY = Math.sin(cam.rotY);
  const cosX = Math.cos(cam.rotX), sinX = Math.sin(cam.rotX);
  const x = node.x - cam.x;
  const y = node.y - cam.y;
  const z = node.z - cam.z;
  const x1 = x * cosY + z * sinY;
  const z1 = -x * sinY + z * cosY;
  const y2 = y * cosX - z1 * sinX;
  const z2 = y * sinX + z1 * cosX;
  const fov = cam.fov;
  const depth = fov + z2;
  const scale = fov / depth;
  node.sx = w * 0.5 + x1 * scale;
  node.sy = h * 0.5 + y2 * scale;
  node.scale = scale;
  node.depth = z2;
}

function iconGlyph(type: NodeKind): string {
  switch (type) {
    case 'audio':  return '♪';
    case 'mail':   return '✉';
    case 'notion': return 'N';
    case 'pdf':    return 'P';
    case 'link':   return '◯';
    case 'doc':
    default:       return 'D';
  }
}

type Theme = {
  edge: string;
  edgeAlpha: number;
  labelBg: string;
  labelBgA: number;
  labelInk: string;
  haloStrong: number;
};

const THEMES: Record<'light' | 'dark', Theme> = {
  light: {
    edge: `oklch(0.5 0.04 280 / ALPHA)`,
    edgeAlpha: 0.35,
    labelBg: `oklch(1 0 0 / ALPHA)`,
    labelBgA: 0.85,
    labelInk: `oklch(0.3 0.02 280 / ALPHA)`,
    haloStrong: 0.07,
  },
  dark: {
    edge: `oklch(0.8 0.04 280 / ALPHA)`,
    edgeAlpha: 0.25,
    labelBg: `oklch(0.2 0.03 290 / ALPHA)`,
    labelBgA: 0.85,
    labelInk: `oklch(0.95 0 0 / ALPHA)`,
    haloStrong: 0.12,
  },
};

function render(ctx: CanvasRenderingContext2D, graph: Graph, cam: Camera, w: number, h: number, theme: Theme) {
  ctx.clearRect(0, 0, w, h);

  for (const n of graph.nodes) project(n, cam, w, h);

  const sorted = graph.nodes.slice().sort((a, b) => b.depth - a.depth);

  for (const c of Object.values(graph.clusterMap)) {
    const fake: { x: number; y: number; z: number; sx?: number; sy?: number; scale?: number } = { x: c.cx, y: c.cy, z: c.cz };
    project(fake, cam, w, h);
    const fSx = fake.sx!, fSy = fake.sy!, fScale = fake.scale!;
    const r = 90 * fScale;
    const g = ctx.createRadialGradient(fSx, fSy, 0, fSx, fSy, r);
    g.addColorStop(0, `oklch(0.6 0.22 ${c.hue} / ${theme.haloStrong})`);
    g.addColorStop(1, `oklch(0.6 0.22 ${c.hue} / 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fSx, fSy, r, 0, TAU);
    ctx.fill();
  }

  ctx.lineCap = 'round';
  for (const e of graph.edges) {
    const { a, b } = e;
    const avgDepth = (a.depth + b.depth) * 0.5;
    const fade = Math.max(0, Math.min(1, 1 - avgDepth / 400));
    const cited = a.pulse > 0 && b.pulse > 0;
    if (cited) {
      ctx.strokeStyle = `oklch(0.7 0.2 ${a.hue} / ${(0.85 * fade).toFixed(3)})`;
      ctx.lineWidth = 1.6;
      ctx.shadowColor = `oklch(0.7 0.2 ${a.hue})`;
      ctx.shadowBlur = 10;
    } else {
      ctx.strokeStyle = theme.edge.replace('ALPHA', (fade * theme.edgeAlpha).toFixed(3));
      ctx.lineWidth = 1;
      ctx.shadowBlur = 0;
    }
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  for (const n of sorted) {
    const r = n.radius * n.scale * 1.4;
    const fade = Math.max(0.2, Math.min(1, 1 - n.depth / 400));

    if (n.pulse > 0) {
      const pr = r * (1.6 + (1 - n.pulse) * 2);
      ctx.strokeStyle = `oklch(0.72 0.2 ${n.hue} / ${n.pulse.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(n.sx, n.sy, pr, 0, TAU);
      ctx.stroke();
    }

    const glow = ctx.createRadialGradient(n.sx, n.sy, 0, n.sx, n.sy, r * 3);
    glow.addColorStop(0, `oklch(0.7 0.2 ${n.hue} / ${(0.4 * fade).toFixed(3)})`);
    glow.addColorStop(1, `oklch(0.7 0.2 ${n.hue} / 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(n.sx, n.sy, r * 3, 0, TAU);
    ctx.fill();

    const bodyLightness = n.checked ? 0.62 : 0.55;
    ctx.fillStyle = `oklch(${bodyLightness} 0.22 ${n.hue} / ${fade.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(n.sx, n.sy, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = `oklch(0.95 0.05 ${n.hue} / ${(fade * 0.6).toFixed(3)})`;
    ctx.lineWidth = 1;
    ctx.stroke();

    if (n.checked) {
      const cr = r * 0.55;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(n.sx + r * 0.8, n.sy - r * 0.8, cr, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `oklch(0.5 0.2 ${n.hue})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(n.sx + r * 0.5, n.sy - r * 0.8);
      ctx.lineTo(n.sx + r * 0.72, n.sy - r * 0.6);
      ctx.lineTo(n.sx + r * 1.05, n.sy - r * 1.0);
      ctx.stroke();
    }

    if (n.scale > 0.85 && r > 6) {
      ctx.fillStyle = `oklch(0.98 0 0 / ${fade.toFixed(3)})`;
      ctx.font = `${Math.round(r * 1.3)}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(iconGlyph(n.type), n.sx, n.sy);
    }
  }

  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const n of sorted) {
    const showAlways = n.pulse > 0 || n.checked;
    if (!showAlways && n.scale < 1.05) continue;
    const alpha = showAlways ? 1 : Math.min(1, (n.scale - 1.05) * 4);
    if (alpha <= 0) continue;
    const r = n.radius * n.scale * 1.4;
    const label = n.label;
    const metrics = ctx.measureText(label);
    const bx = n.sx + r + 6;
    const by = n.sy - 8;
    ctx.fillStyle = theme.labelBg.replace('ALPHA', (alpha * theme.labelBgA).toFixed(3));
    ctx.fillRect(bx - 4, by, metrics.width + 8, 16);
    ctx.fillStyle = theme.labelInk.replace('ALPHA', alpha.toFixed(3));
    ctx.fillText(label, bx, by + 8);
  }
}

export type HeroGraphApi = {
  graph: Graph;
  setTheme(name: 'light' | 'dark'): void;
  pulseNodes(ids: string[], intensity?: number): void;
  checkNodes(ids: string[], checked: boolean): void;
  magnetizeTo(ids: string[], x: number, y: number, strength?: number): void;
  stop(): void;
};

export function createHeroGraph(canvas: HTMLCanvasElement, opts?: { theme?: 'light' | 'dark' }): HeroGraphApi {
  const ctx = canvas.getContext('2d')!;
  const graph = createGraph();
  const cam: Camera = { x: 0, y: 0, z: -320, rotY: 0, rotX: -0.08, fov: 450 };
  const cursor: Cursor = { sx: 0, sy: 0, wx: 0, wy: 0, active: false };

  let w = 0, h = 0;
  let running = true;
  let lastT = performance.now();
  let targetRotY = 0;
  let targetRotX = -0.08;
  let scrollT = 0;
  let themeName: 'light' | 'dark' = opts?.theme ?? 'light';

  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = rect.width; h = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - lastT) / 16);
    lastT = now;

    cam.rotY += (targetRotY - cam.rotY) * 0.06;
    cam.rotX += (targetRotX - cam.rotX) * 0.06;
    cam.rotY += Math.sin(now * 0.00015) * 0.0003;
    const scrollZ = -320 - scrollT * 380;
    cam.z += (scrollZ - cam.z) * 0.05;

    step(graph, cursor, dt);
    render(ctx, graph, cam, w, h, THEMES[themeName]);

    requestAnimationFrame(frame);
  }

  function onMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    cursor.sx = mx;
    cursor.sy = my;
    cursor.active = mx >= 0 && mx <= w && my >= 0 && my <= h;
    const nx = (mx - w * 0.5) / (cam.fov / (cam.fov - cam.z));
    const ny = (my - h * 0.5) / (cam.fov / (cam.fov - cam.z));
    cursor.wx = nx;
    cursor.wy = ny;
    const nmx = (mx / w) * 2 - 1;
    const nmy = (my / h) * 2 - 1;
    targetRotY = nmx * 0.35;
    targetRotX = -0.08 + nmy * 0.15;
  }

  function onLeave() {
    cursor.active = false;
    targetRotY = 0;
    targetRotX = -0.08;
  }

  function onScroll() {
    const rect = canvas.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, -rect.top / (rect.height * 0.6)));
    scrollT = t;
  }

  resize();
  window.addEventListener('resize', resize);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseleave', onLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  requestAnimationFrame(frame);

  return {
    graph,
    setTheme(name) { themeName = name; },
    pulseNodes(ids, intensity = 1) {
      ids.forEach(id => {
        const n = graph.nodeById[id];
        if (n) n.pulse = Math.max(n.pulse, intensity);
      });
    },
    checkNodes(ids, checked) {
      ids.forEach(id => {
        const n = graph.nodeById[id];
        if (n) n.checked = !!checked;
      });
    },
    magnetizeTo(ids, x, y, strength = 0.2) {
      ids.forEach(id => {
        const n = graph.nodeById[id];
        if (n) {
          n.vx += (x - n.x) * strength;
          n.vy += (y - n.y) * strength;
        }
      });
    },
    stop() {
      running = false;
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', resize);
    },
  };
}
