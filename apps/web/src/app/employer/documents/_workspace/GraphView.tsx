"use client";

import {
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { IconPlus, IconSearch } from "./icons";

export interface GraphNode {
  id: number;
  name: string;
  label: string;
  mentionCount: number;
  confidence: number;
}

export interface GraphEdge {
  source: number;
  target: number;
  type: string;
  weight: number;
  evidenceCount: number;
}

interface GraphResponse {
  source: "neo4j" | "postgres" | "empty";
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: { entities: number; relationships: number; truncated: boolean };
}

const GRAPH_WIDTH = 1400;
const GRAPH_HEIGHT = 900;

// Deterministic palette keyed on the NER label set (PER, ORG, LOC, etc).
const LABEL_COLOR: Record<string, string> = {
  PER: "oklch(0.6 0.17 285)",
  ORG: "oklch(0.58 0.15 165)",
  LOC: "oklch(0.6 0.14 225)",
  DATE: "oklch(0.65 0.12 95)",
  MONEY: "oklch(0.6 0.15 140)",
  EVENT: "oklch(0.62 0.16 45)",
  PRODUCT: "oklch(0.55 0.17 330)",
  LAW: "oklch(0.55 0.14 35)",
  MISC: "oklch(0.55 0.02 280)",
};

function labelColor(label: string): string {
  return LABEL_COLOR[label] ?? LABEL_COLOR.MISC!;
}

interface LaidNode extends GraphNode {
  x: number;
  y: number;
}

function computeLayout(nodes: GraphNode[]): {
  laid: LaidNode[];
  byId: Record<number, LaidNode>;
  byLabel: Record<string, { center: { x: number; y: number }; count: number }>;
} {
  const byLabel = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const key = n.label || "MISC";
    if (!byLabel.has(key)) byLabel.set(key, []);
    byLabel.get(key)!.push(n);
  }
  const labels = [...byLabel.keys()];
  const R = Math.min(GRAPH_WIDTH, GRAPH_HEIGHT) * 0.28;
  const cx = GRAPH_WIDTH / 2;
  const cy = GRAPH_HEIGHT / 2;
  const centers: Record<string, { x: number; y: number }> = {};
  labels.forEach((name, i) => {
    const angle = (i / labels.length) * Math.PI * 2 - Math.PI / 2;
    centers[name] = { x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R };
  });

  const laid: LaidNode[] = [];
  for (const [name, group] of byLabel.entries()) {
    const base = centers[name]!;
    const innerR = 60 + Math.min(group.length * 4, 70);
    group.forEach((n, idx) => {
      const theta =
        (idx / Math.max(group.length, 1)) * Math.PI * 2 + name.length * 0.3;
      laid.push({
        ...n,
        x: base.x + Math.cos(theta) * innerR,
        y: base.y + Math.sin(theta) * innerR,
      });
    });
  }
  const byId = Object.fromEntries(laid.map((n) => [n.id, n])) as Record<
    number,
    LaidNode
  >;
  const labelSummary = Object.fromEntries(
    labels.map((l) => [
      l,
      { center: centers[l]!, count: byLabel.get(l)!.length },
    ]),
  );
  return { laid, byId, byLabel: labelSummary };
}

export interface GraphViewProps {
  /** Optional document scope; if null, loads the whole company graph. */
  documentId?: number | null;
}

export function GraphView({ documentId }: GraphViewProps) {
  const [data, setData] = useState<GraphResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hoverNode, setHoverNode] = useState<number | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{ startX: number; startY: number; pan: { x: number; y: number } } | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("limit", "120");
        if (documentId != null) params.set("documentId", String(documentId));
        const res = await fetch(`/api/graph/entities?${params.toString()}`);
        if (!res.ok) throw new Error(`Failed (${res.status})`);
        const json = (await res.json()) as GraphResponse;
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load graph");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })().catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const layout = useMemo(
    () => (data ? computeLayout(data.nodes) : null),
    [data],
  );

  const filteredNodeIds = useMemo(() => {
    if (!layout) return new Set<number>();
    if (!query.trim()) return new Set(layout.laid.map((n) => n.id));
    const q = query.toLowerCase();
    return new Set(
      layout.laid.filter((n) => n.name.toLowerCase().includes(q)).map((n) => n.id),
    );
  }, [layout, query]);

  const neighbors = useMemo(() => {
    if (!hoverNode || !data) return new Set<number>();
    const set = new Set<number>([hoverNode]);
    for (const e of data.edges) {
      if (e.source === hoverNode) set.add(e.target);
      if (e.target === hoverNode) set.add(e.source);
    }
    return set;
  }, [hoverNode, data]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    setZoom((z) => Math.min(3, Math.max(0.4, z + z * delta)));
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    const target = e.target as Element;
    if (target.tagName === "svg" || target.classList.contains("pan-surface")) {
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        pan,
      };
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    }
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    setPan({
      x: dragRef.current.pan.x + (e.clientX - dragRef.current.startX) / zoom,
      y: dragRef.current.pan.y + (e.clientY - dragRef.current.startY) / zoom,
    });
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  useEffect(() => {
    const up = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointerup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("blur", up);
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          position: "absolute",
          top: 14,
          left: 14,
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 10,
          boxShadow: "0 4px 14px var(--scrim-shadow)",
          minWidth: 280,
        }}
      >
        <IconSearch size={12} style={{ color: "var(--ink-3)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an entity…"
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            background: "transparent",
            fontSize: 12,
            color: "var(--ink)",
          }}
        />
        {data && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-3)",
              padding: "1px 6px",
              border: "1px solid var(--line)",
              borderRadius: 4,
            }}
            title={
              data.source === "neo4j"
                ? "Served from Neo4j"
                : data.source === "postgres"
                ? "Served from Postgres fallback"
                : "No graph data yet"
            }
          >
            {data.source}
          </span>
        )}
      </div>

      {/* Status banners */}
      {loading && (
        <CenterNote>Loading knowledge graph…</CenterNote>
      )}
      {error && !loading && (
        <CenterNote tone="danger">{error}</CenterNote>
      )}
      {!loading && !error && data && data.nodes.length === 0 && (
        <CenterNote>
          No entities extracted yet. Upload documents and let entity extraction
          run — then come back to this view.
        </CenterNote>
      )}

      {layout && (
        <svg
          viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          style={{
            width: "100%",
            height: "100%",
            cursor: dragRef.current ? "grabbing" : "grab",
            touchAction: "none",
          }}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <defs>
            <pattern
              id="graph-grid"
              width="40"
              height="40"
              patternUnits="userSpaceOnUse"
            >
              <path
                d="M 40 0 L 0 0 0 40"
                fill="none"
                stroke="var(--line)"
                strokeWidth="0.5"
                opacity="0.5"
              />
            </pattern>
          </defs>

          <rect
            className="pan-surface"
            width={GRAPH_WIDTH}
            height={GRAPH_HEIGHT}
            fill="url(#graph-grid)"
          />

          <g
            transform={`translate(${pan.x * zoom}, ${pan.y * zoom}) scale(${zoom}) translate(${
              (GRAPH_WIDTH * (1 - 1 / zoom)) / 2
            }, ${(GRAPH_HEIGHT * (1 - 1 / zoom)) / 2})`}
          >
            {/* Label cluster bubbles */}
            {Object.entries(layout.byLabel).map(([name, info]) => {
              const color = labelColor(name);
              return (
                <g key={name}>
                  <circle
                    cx={info.center.x}
                    cy={info.center.y}
                    r={105 + info.count * 2}
                    fill={color}
                    opacity={0.08}
                    stroke={color}
                    strokeOpacity={0.2}
                    strokeWidth={0.8}
                    strokeDasharray="3 4"
                  />
                  <text
                    x={info.center.x}
                    y={info.center.y - (110 + info.count * 2)}
                    textAnchor="middle"
                    fontSize="11"
                    fontWeight="700"
                    fill="var(--ink-2)"
                    style={{
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      pointerEvents: "none",
                    }}
                  >
                    {name}
                  </text>
                </g>
              );
            })}

            {/* Edges */}
            {data!.edges.map((e, i) => {
              const a = layout.byId[e.source];
              const b = layout.byId[e.target];
              if (!a || !b) return null;
              const hot = hoverNode && (e.source === hoverNode || e.target === hoverNode);
              const dim = hoverNode && !hot;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={hot ? "var(--accent)" : "var(--ink-3)"}
                  strokeWidth={Math.min(0.6 + e.weight * 2.4, 3)}
                  opacity={dim ? 0.05 : hot ? 0.85 : 0.2}
                />
              );
            })}

            {/* Nodes */}
            {layout.laid.map((n) => {
              const isSelected = selected.has(n.id);
              const isHover = hoverNode === n.id;
              const isNeighbor = neighbors.has(n.id);
              const isQueryMatch = filteredNodeIds.has(n.id);
              const dim =
                (hoverNode && !isNeighbor) || (query.trim() && !isQueryMatch);
              const r = 6 + Math.min(Math.sqrt(n.mentionCount) * 2, 12) + (isSelected ? 4 : 0);
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x}, ${n.y})`}
                  opacity={dim ? 0.25 : 1}
                  style={{
                    cursor: "pointer",
                    transition: "opacity 120ms",
                  }}
                  onMouseEnter={() => setHoverNode(n.id)}
                  onMouseLeave={() => setHoverNode(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(n.id);
                  }}
                >
                  {isSelected && (
                    <circle
                      r={r + 5}
                      fill="none"
                      stroke="var(--accent)"
                      strokeWidth="1.5"
                      opacity="0.55"
                    />
                  )}
                  <circle
                    r={r}
                    fill={isSelected ? "var(--accent)" : labelColor(n.label)}
                    stroke={isHover ? "var(--ink)" : "var(--panel)"}
                    strokeWidth={isHover ? 2 : 1.5}
                  />
                  <text
                    x={0}
                    y={r + 11}
                    textAnchor="middle"
                    fontSize="10"
                    fontWeight="500"
                    fill={isHover || isSelected ? "var(--ink)" : "var(--ink-2)"}
                    style={{ pointerEvents: "none" }}
                  >
                    {n.name.length > 18 ? n.name.slice(0, 18) + "…" : n.name}
                  </text>
                </g>
              );
            })}

            {/* Hover tooltip */}
            {hoverNode && layout.byId[hoverNode] && (() => {
              const n = layout.byId[hoverNode]!;
              const edgesForNode = data!.edges.filter(
                (e) => e.source === n.id || e.target === n.id,
              );
              const boxW = 230;
              const tx = Math.min(n.x + 18, GRAPH_WIDTH - boxW - 10);
              const ty = Math.max(n.y - 30, 10);
              return (
                <g transform={`translate(${tx}, ${ty})`} style={{ pointerEvents: "none" }}>
                  <rect
                    width={boxW}
                    height={60}
                    rx="8"
                    fill="var(--panel)"
                    stroke="var(--line)"
                    strokeWidth="1"
                    filter="drop-shadow(0 4px 12px var(--scrim-shadow))"
                  />
                  <text
                    x="12"
                    y="20"
                    fontSize="12"
                    fontWeight="600"
                    fill="var(--ink)"
                    style={{ dominantBaseline: "middle" }}
                  >
                    {n.name.length > 28 ? n.name.slice(0, 28) + "…" : n.name}
                  </text>
                  <text x="12" y="38" fontSize="10.5" fill="var(--ink-3)">
                    {n.label} · {n.mentionCount} mention
                    {n.mentionCount !== 1 ? "s" : ""}
                  </text>
                  <text x="12" y="53" fontSize="10" fill="var(--accent-ink)" fontWeight="500">
                    {edgesForNode.length} relationship
                    {edgesForNode.length !== 1 ? "s" : ""}
                  </text>
                </g>
              );
            })()}
          </g>
        </svg>
      )}

      {/* Legend */}
      {data && data.nodes.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            padding: "10px 12px",
            fontSize: 11,
            display: "flex",
            flexDirection: "column",
            gap: 5,
            minWidth: 170,
            boxShadow: "0 4px 14px var(--scrim-shadow)",
            zIndex: 2,
          }}
        >
          <div
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "var(--ink-3)",
              textTransform: "uppercase",
              marginBottom: 2,
            }}
          >
            Entity types
          </div>
          {Object.entries(layout!.byLabel)
            .sort((a, b) => b[1].count - a[1].count)
            .map(([name, info]) => (
              <div
                key={name}
                style={{ display: "flex", alignItems: "center", gap: 6 }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: labelColor(name),
                    flexShrink: 0,
                  }}
                />
                <span style={{ color: "var(--ink-2)", flex: 1 }}>{name}</span>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--ink-3)" }}
                >
                  {info.count}
                </span>
              </div>
            ))}
          <div style={{ height: 1, background: "var(--line)", margin: "4px 0" }} />
          <div
            className="mono"
            style={{ fontSize: 10, color: "var(--ink-3)", lineHeight: 1.5 }}
          >
            {data.stats.entities} nodes · {data.stats.relationships} edges
            {data.stats.truncated && " · truncated"}
          </div>
        </div>
      )}

      {/* Zoom controls */}
      {data && data.nodes.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            right: 14,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 8,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 2px 8px var(--scrim-shadow)",
            zIndex: 2,
          }}
        >
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.2))}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-2)",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <IconPlus size={12} />
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Reset view"
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-2)",
              fontSize: 10,
              fontWeight: 700,
              borderBottom: "1px solid var(--line)",
            }}
          >
            {Math.round(zoom * 100)}
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}
            style={{
              width: 28,
              height: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ink-2)",
            }}
          >
            <div style={{ width: 10, height: 2, background: "var(--ink-2)" }} />
          </button>
        </div>
      )}

      {/* Hint */}
      {data && data.nodes.length > 0 && (
        <div
          style={{
            position: "absolute",
            bottom: 14,
            left: 14,
            fontSize: 11,
            color: "var(--ink-3)",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 6,
            padding: "5px 9px",
            boxShadow: "0 2px 8px var(--scrim-shadow)",
            zIndex: 2,
          }}
          className="mono"
        >
          click to select · scroll to zoom · drag to pan
        </div>
      )}
    </div>
  );
}

function CenterNote({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "danger";
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 1,
      }}
    >
      <div
        style={{
          padding: "14px 20px",
          borderRadius: 12,
          background: "var(--panel)",
          border: "1px solid var(--line)",
          color: tone === "danger" ? "var(--danger)" : "var(--ink-2)",
          fontSize: 13,
          maxWidth: 420,
          textAlign: "center",
          boxShadow: "0 6px 24px var(--scrim-shadow)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
