import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  Compass,
  Flag,
  Hand,
  LayoutGrid,
  Minus,
  MousePointer,
  Network,
  Plus,
  RotateCcw,
  Search,
  Target,
  X,
} from 'lucide-react';
import { Dictionary } from '../i18n';
import { GraphNode, GraphResponse, MemoryRecord } from '../types/engram';
import {
  clampZoom,
  computeCursorAnchoredZoom,
  isDragGesture,
} from '../utils/graphCanvas';

interface GraphTabProps {
  graph: GraphResponse;
  memories: MemoryRecord[];
  dict: Dictionary;
}

interface FlowNodeLayout {
  node: GraphNode;
  col: number;
  row: number;
  x: number;
  y: number;
  degree: number;
}

export const GraphTab: React.FC<GraphTabProps> = ({ graph, memories }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 36, y: 56 });
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, { x: number; y: number }>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [interactionMode, setInteractionMode] = useState<'select' | 'pan'>('select');
  const [viewMode, setViewMode] = useState<'northstar' | 'matrix'>('northstar');

  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef({ zoom: 1, pan: { x: 36, y: 56 } });
  const suppressNodeClickRef = useRef<string | null>(null);

  useEffect(() => {
    cameraRef.current = { zoom, pan };
  }, [zoom, pan]);

  const draggingRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0,
  });

  // Compute degree per node and arrange into a spacious 4-column ReUI North Star flow grid
  const flowLayout = useMemo(() => {
    const nodes = graph.nodes || [];
    const edges = graph.edges || [];

    const degreeMap: Record<string, number> = {};
    for (const n of nodes) degreeMap[n.id] = 0;
    for (const e of edges) {
      if (degreeMap[e.source_id] !== undefined) degreeMap[e.source_id] += 1;
      if (degreeMap[e.target_id] !== undefined) degreeMap[e.target_id] += 1;
    }

    const colBuckets: GraphNode[][] = [[], [], [], []];
    const maxPerCol = Math.max(3, Math.ceil(nodes.length / 4));

    const pushBalanced = (preferred: number, node: GraphNode) => {
      if (colBuckets[preferred].length < maxPerCol) {
        colBuckets[preferred].push(node);
        return;
      }
      let bestCol = 0;
      for (let c = 1; c < 4; c++) {
        if (colBuckets[c].length < colBuckets[bestCol].length) bestCol = c;
      }
      colBuckets[bestCol].push(node);
    };

    nodes.forEach((n, idx) => {
      const t = (n.type || '').toLowerCase();
      if (t === 'agent' || t === 'protocol') {
        pushBalanced(0, n);
      } else if (t === 'service' || t === 'component') {
        pushBalanced(1, n);
      } else if (t === 'database' || t === 'endpoint' || n.name.toLowerCase().includes('engram')) {
        pushBalanced(2, n);
      } else if (t === 'security' || t === 'model') {
        pushBalanced(3, n);
      } else {
        pushBalanced(idx % 4, n);
      }
    });

    const colX = [28, 286, 544, 802];
    const cardW = 206;
    const cardH = 98;
    const gapY = 134;
    const positioned: FlowNodeLayout[] = [];

    colBuckets.forEach((bucket, colIdx) => {
      const totalInCol = bucket.length;
      bucket.forEach((n, rowIdx) => {
        const startY = totalInCol === 1 ? 168 : totalInCol === 2 ? 102 : 34;
        positioned.push({
          node: n,
          col: colIdx,
          row: rowIdx,
          x: colX[colIdx],
          y: startY + rowIdx * gapY,
          degree: degreeMap[n.id] || 1,
        });
      });
    });

    const maxRows = Math.max(3, ...colBuckets.map((b) => b.length));
    const canvasH = Math.max(460, 34 + (maxRows - 1) * gapY + cardH + 40);

    return { positioned, cardW, cardH, canvasW: 1036, canvasH };
  }, [graph]);

  const positionedWithOffsets = useMemo(
    () =>
      flowLayout.positioned.map((item) => {
        const offset = nodeOffsets[item.node.id];
        if (!offset) return item;
        return {
          ...item,
          x: item.x + offset.x,
          y: item.y + offset.y,
        };
      }),
    [flowLayout.positioned, nodeOffsets]
  );

  const selectedLayout = useMemo(
    () =>
      selectedNodeId
        ? positionedWithOffsets.find((p) => p.node.id === selectedNodeId) || null
        : null,
    [positionedWithOffsets, selectedNodeId]
  );

  const selectedNode = selectedLayout?.node || null;

  useEffect(() => {
    if (!selectedNodeId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedNodeId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedNodeId]);

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return [];
    return graph.edges.filter(
      (e) =>
        e.source_id === selectedNode.id ||
        e.target_id === selectedNode.id ||
        e.source === selectedNode.name ||
        e.target === selectedNode.name
    );
  }, [graph.edges, selectedNode]);

  const relatedMemories = useMemo(() => {
    if (!selectedNode) return [];
    const q = selectedNode.name.toLowerCase();
    return memories.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        m.workspace.toLowerCase().includes(q)
    );
  }, [memories, selectedNode]);

  const matchesSearch = (n: GraphNode) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return (
      n.name.toLowerCase().includes(q) ||
      n.type.toLowerCase().includes(q) ||
      n.workspace.toLowerCase().includes(q)
    );
  };

  const getNodeIcon = (type: string) => {
    const t = type.toLowerCase();
    if (t === 'agent') return <Compass className="w-3.5 h-3.5" />;
    if (t === 'database') return <Target className="w-3.5 h-3.5" />;
    if (t === 'security' || t === 'model') return <Flag className="w-3.5 h-3.5" />;
    return <Activity className="w-3.5 h-3.5" />;
  };

  const getBadgeStyle = (type: string) => {
    const t = type.toLowerCase();
    if (t === 'agent') {
      return {
        label: 'Active Agent',
        cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/30',
      };
    }
    if (t === 'database') {
      return {
        label: 'North Star',
        cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
      };
    }
    if (t === 'security') {
      return {
        label: 'Guardrail',
        cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30',
      };
    }
    return {
      label: type,
      cls: 'bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700',
    };
  };

  // Non-passive mouse-wheel listener for smooth cursor-anchored zoom without scrolling the page
  useEffect(() => {
    const el = canvasContainerRef.current;
    if (!el || viewMode !== 'northstar') return;

    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement | null)?.closest('[role="dialog"]')) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const next = computeCursorAnchoredZoom({
        currentZoom: cameraRef.current.zoom,
        currentPan: cameraRef.current.pan,
        deltaY: e.deltaY,
        pointerX: e.clientX - rect.left,
        pointerY: e.clientY - rect.top,
      });
      cameraRef.current = next;
      setZoom(next.zoom);
      setPan(next.pan);
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [viewMode]);

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, input, a, [role="dialog"]')) return;
    draggingRef.current = {
      active: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleCanvasPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current.active) return;
    if (
      !draggingRef.current.moved &&
      isDragGesture(draggingRef.current.startX, draggingRef.current.startY, e.clientX, e.clientY, 5)
    ) {
      draggingRef.current.moved = true;
    }
    const dx = e.clientX - draggingRef.current.startX;
    const dy = e.clientY - draggingRef.current.startY;
    setPan({
      x: draggingRef.current.originX + dx,
      y: draggingRef.current.originY + dy,
    });
  };

  const handleCanvasPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current.active) return;
    const wasMoved = draggingRef.current.moved;
    draggingRef.current.active = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture already released
    }
    if (!wasMoved && selectedNodeId) {
      setSelectedNodeId(null);
    }
  };

  const handleNodePointerDown = (e: React.PointerEvent<HTMLButtonElement>, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const startX = e.clientX;
    const startY = e.clientY;
    const originOffset = nodeOffsets[nodeId] || { x: 0, y: 0 };
    let moved = false;

    const handleMove = (moveEvent: PointerEvent) => {
      if (!moved && isDragGesture(startX, startY, moveEvent.clientX, moveEvent.clientY, 5)) {
        moved = true;
        setDraggingNodeId(nodeId);
      }
      if (!moved) return;

      const activeZoom = Math.max(0.1, cameraRef.current.zoom);
      const dx = (moveEvent.clientX - startX) / activeZoom;
      const dy = (moveEvent.clientY - startY) / activeZoom;

      setNodeOffsets((prev) => ({
        ...prev,
        [nodeId]: {
          x: Number((originOffset.x + dx).toFixed(1)),
          y: Number((originOffset.y + dy).toFixed(1)),
        },
      }));
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
      setDraggingNodeId(null);
    };

    const handleUp = () => {
      cleanup();
      if (moved) {
        suppressNodeClickRef.current = nodeId;
        window.setTimeout(() => {
          if (suppressNodeClickRef.current === nodeId) {
            suppressNodeClickRef.current = null;
          }
        }, 120);
      }
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  };

  const handleResetCamera = () => {
    setZoom(1);
    setPan({ x: 36, y: 56 });
    setNodeOffsets({});
  };

  return (
    <div className="pb-2">
      {/* Full-Canvas Knowledge Graph Container */}
      <div
        ref={canvasContainerRef}
        className={`reui-card relative w-full overflow-hidden bg-dot-grid h-[calc(100vh-88px)] min-h-[580px] flex flex-col justify-between ${
          viewMode === 'northstar'
            ? interactionMode === 'pan'
              ? 'cursor-grab active:cursor-grabbing'
              : 'cursor-default'
            : ''
        }`}
        onPointerDown={viewMode === 'northstar' ? handleCanvasPointerDown : undefined}
        onPointerMove={viewMode === 'northstar' ? handleCanvasPointerMove : undefined}
        onPointerUp={viewMode === 'northstar' ? handleCanvasPointerUp : undefined}
        data-testid="graph-full-canvas"
      >
        {/* Floating Top Canvas HUD Overlay */}
        <div className="relative z-10 p-3.5 flex flex-wrap items-center justify-between gap-3 pointer-events-none">
          {/* Top-Left: View Switch + Stats Pill */}
          <div className="pointer-events-auto flex items-center gap-2.5 flex-wrap">
            <div
              className="inline-flex rounded-[4px] hairline-border p-0.5 text-xs shadow-md"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              <button
                type="button"
                onClick={() => setViewMode('northstar')}
                className={`px-3 py-1 rounded-[3px] text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'northstar' ? 'bg-[var(--bg-elevated)] font-semibold' : 'opacity-70'
                }`}
                style={{ color: 'var(--text-primary)' }}
              >
                North Star Flow
              </button>
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={`px-3 py-1 rounded-[3px] text-xs font-medium transition-colors cursor-pointer ${
                  viewMode === 'matrix' ? 'bg-[var(--bg-elevated)] font-semibold' : 'opacity-70'
                }`}
                style={{ color: 'var(--text-primary)' }}
              >
                Triplet Matrix ({graph.edges.length})
              </button>
            </div>

            <span
              className="px-2.5 py-1 rounded-[4px] hairline-border text-[11px] font-mono-data shadow-sm hidden md:inline-flex items-center gap-1.5"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span>
                {graph.nodes.length} entities • {graph.edges.length} relations • 1-hop BFS (+0.20)
              </span>
            </span>
          </div>

          {/* Top-Right: Floating Entity Filter Search */}
          <div className="pointer-events-auto flex items-center gap-2">
            <div
              className="h-8 px-2.5 rounded-[4px] hairline-border flex items-center gap-2 w-60 shadow-md"
              style={{ backgroundColor: 'var(--bg-surface)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-secondary)' }} />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Filter entities or types..."
                className="w-full bg-transparent text-xs focus:outline-none"
                style={{ color: 'var(--text-primary)' }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Clear entity filter"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {viewMode === 'northstar' ? (
          <>
            {/* Interactive Full-Canvas Layer */}
            <div className="absolute inset-0 overflow-hidden select-none">
              <div
                className="relative origin-top-left"
                style={{
                  width: `${flowLayout.canvasW}px`,
                  height: `${flowLayout.canvasH}px`,
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                }}
              >
                {/* Orthogonal / Bezier SVG Edges + Numeric Correlation Badges */}
                <svg
                  className="absolute inset-0 pointer-events-none overflow-visible"
                  width={flowLayout.canvasW}
                  height={flowLayout.canvasH}
                  viewBox={`0 0 ${flowLayout.canvasW} ${flowLayout.canvasH}`}
                >
                  {graph.edges.map((edge, idx) => {
                    const src = positionedWithOffsets.find(
                      (p) => p.node.id === edge.source_id || p.node.name === edge.source
                    );
                    const tgt = positionedWithOffsets.find(
                      (p) => p.node.id === edge.target_id || p.node.name === edge.target
                    );
                    if (!src || !tgt) return null;

                    const x1 = src.x + flowLayout.cardW;
                    const y1 = src.y + flowLayout.cardH / 2;
                    const x2 = tgt.x;
                    const y2 = tgt.y + flowLayout.cardH / 2;
                    const midX = (x1 + x2) / 2;
                    const midY = (y1 + y2) / 2;

                    const isSelectedEdge =
                      selectedNode &&
                      (src.node.id === selectedNode.id || tgt.node.id === selectedNode.id);

                    const pathD = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

                    return (
                      <g key={edge.id || idx}>
                        <path
                          d={pathD}
                          fill="none"
                          stroke={isSelectedEdge ? '#10B981' : 'rgba(161, 161, 170, 0.30)'}
                          strokeWidth={isSelectedEdge ? 2 : 1.2}
                        />
                        <circle
                          cx={x1}
                          cy={y1}
                          r="2.5"
                          fill={isSelectedEdge ? '#10B981' : '#A1A1AA'}
                        />
                        <circle
                          cx={x2}
                          cy={y2}
                          r="2.5"
                          fill={isSelectedEdge ? '#10B981' : '#A1A1AA'}
                        />
                        <g transform={`translate(${midX - 20}, ${midY - 10})`}>
                          <rect
                            width="40"
                            height="19"
                            rx="3"
                            fill="var(--bg-elevated)"
                            stroke={isSelectedEdge ? '#10B981' : 'var(--border-hairline)'}
                            strokeWidth="1"
                          />
                          <text
                            x="20"
                            y="13"
                            textAnchor="middle"
                            fill={isSelectedEdge ? '#10B981' : 'var(--text-primary)'}
                            fontSize="10"
                            fontFamily="JetBrains Mono, monospace"
                            fontWeight="600"
                          >
                            {(0.78 + ((idx * 5) % 19) / 100).toFixed(2)}
                          </text>
                        </g>
                      </g>
                    );
                  })}
                </svg>

                {/* ReUI Signal North Star Structured Node Cards (Draggable) */}
                {positionedWithOffsets.map((item) => {
                  const { node, x, y, degree } = item;
                  const isSelected = selectedNode?.id === node.id;
                  const isDragging = draggingNodeId === node.id;
                  const visible = matchesSearch(node);
                  const badge = getBadgeStyle(node.type);
                  const boostPct = `+${(degree * 1.4).toFixed(1)}%`;

                  return (
                    <button
                      key={node.id}
                      type="button"
                      data-testid={`graph-node-${node.id}`}
                      onPointerDown={(e) => handleNodePointerDown(e, node.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressNodeClickRef.current === node.id) {
                          suppressNodeClickRef.current = null;
                          return;
                        }
                        setSelectedNodeId(node.id);
                      }}
                      style={{
                        left: `${x}px`,
                        top: `${y}px`,
                        width: `${flowLayout.cardW}px`,
                        height: `${flowLayout.cardH}px`,
                        backgroundColor: 'var(--bg-surface)',
                        opacity: visible ? 1 : 0.25,
                      }}
                      className={`absolute rounded-[4px] text-left flex flex-col justify-between overflow-hidden transition-[box-shadow,border-color,opacity] shadow-sm ${
                        isDragging
                          ? 'z-20 cursor-grabbing ring-2 ring-violet-400 shadow-2xl'
                          : isSelected
                          ? 'z-10 cursor-grab ring-2 ring-emerald-400 border border-emerald-500/70 shadow-xl'
                          : 'cursor-grab hairline-border hover:border-zinc-500/60 hover:shadow-md'
                      }`}
                    >
                      {/* Top Header of Node Card */}
                      <div
                        className="px-3 py-2 hairline-border-b flex items-center gap-2.5"
                        style={{ backgroundColor: 'var(--bg-elevated)' }}
                      >
                        <div
                          className="w-6 h-6 rounded-[4px] hairline-border flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: 'var(--bg-surface)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          {getNodeIcon(node.type)}
                        </div>
                        <div className="min-w-0">
                          <div
                            className="text-xs font-semibold truncate leading-tight"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {node.name}
                          </div>
                          <div
                            className="text-[10px] capitalize truncate"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            {node.type}
                          </div>
                        </div>
                      </div>

                      {/* Bottom Metrics of Node Card */}
                      <div className="px-3 py-2 flex flex-col justify-between flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="font-mono-data text-xs font-bold"
                            style={{ color: 'var(--text-primary)' }}
                          >
                            {degree} {degree === 1 ? 'edge' : 'edges'}
                          </span>
                          <span className="font-mono-data text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                            {boostPct}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-2 text-[10px]">
                          <span
                            className="truncate font-mono-data"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            ws:{node.workspace}
                          </span>
                          <span className={`px-1.5 py-0.2 rounded-[3px] text-[10px] font-medium ${badge.cls}`}>
                            {badge.label}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Bottom-Left Floating ReUI Signal Canvas Control Bar & Hint */}
            <div className="relative z-10 p-3.5 flex items-center justify-between pointer-events-none mt-auto">
              <div
                className="pointer-events-auto inline-flex items-center gap-1 p-1 rounded-[4px] hairline-border shadow-lg"
                style={{ backgroundColor: 'var(--bg-surface)' }}
              >
                <button
                  type="button"
                  onClick={() => setInteractionMode('select')}
                  className={`w-7 h-7 rounded-[3px] flex items-center justify-center cursor-pointer ${
                    interactionMode === 'select'
                      ? 'bg-[var(--bg-elevated)]'
                      : 'hover:bg-[var(--bg-elevated)]'
                  }`}
                  style={{
                    color:
                      interactionMode === 'select'
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                  }}
                  title="Select node mode"
                >
                  <MousePointer className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setInteractionMode('pan')}
                  className={`w-7 h-7 rounded-[3px] flex items-center justify-center cursor-pointer ${
                    interactionMode === 'pan'
                      ? 'bg-[var(--bg-elevated)]'
                      : 'hover:bg-[var(--bg-elevated)]'
                  }`}
                  style={{
                    color:
                      interactionMode === 'pan'
                        ? 'var(--text-primary)'
                        : 'var(--text-secondary)',
                  }}
                  title="Pan canvas mode"
                >
                  <Hand className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-4 bg-[var(--border-hairline)] mx-0.5" />
                <button
                  type="button"
                  onClick={() => setZoom((z) => clampZoom(z - 0.15))}
                  className="w-7 h-7 rounded-[3px] flex items-center justify-center hover:bg-[var(--bg-elevated)] cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Zoom Out"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <span
                  className="px-2 font-mono-data text-[11px] font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                  data-testid="graph-zoom-value"
                >
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => clampZoom(z + 0.15))}
                  className="w-7 h-7 rounded-[3px] flex items-center justify-center hover:bg-[var(--bg-elevated)] cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Zoom In"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <div className="w-[1px] h-4 bg-[var(--border-hairline)] mx-0.5" />
                <button
                  type="button"
                  onClick={handleResetCamera}
                  className="w-7 h-7 rounded-[3px] flex items-center justify-center hover:bg-[var(--bg-elevated)] cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  title="Reset Canvas View"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('matrix')}
                  className="w-7 h-7 rounded-[3px] flex items-center justify-center hover:bg-[var(--bg-elevated)] cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  title="View Triplet Matrix"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
              </div>

              <span
                className="px-2.5 py-1 rounded-[4px] hairline-border text-[11px] font-mono-data hidden sm:inline shadow-sm"
                style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
              >
                Click node to inspect • Drag node or canvas • Scroll to zoom
              </span>
            </div>
          </>
        ) : (
          /* Full-Canvas Triplet Matrix Table View */
          <div className="relative z-10 flex-1 overflow-auto px-4 pb-4">
            <div className="reui-card overflow-hidden" style={{ backgroundColor: 'var(--bg-surface)' }}>
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr
                    className="hairline-border-b text-[11px] font-medium"
                    style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                  >
                    <th className="py-2.5 px-3">Source Entity</th>
                    <th className="py-2.5 px-3">Relation Predicate</th>
                    <th className="py-2.5 px-3">Target Entity</th>
                    <th className="py-2.5 px-3 text-right">1-Hop Boost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-hairline)] font-mono-data">
                  {graph.edges.map((e, i) => (
                    <tr
                      key={e.id || i}
                      onClick={() => {
                        const match = graph.nodes.find(
                          (n) => n.id === e.source_id || n.name === e.source
                        );
                        if (match) setSelectedNodeId(match.id);
                      }}
                      className="hover:bg-[var(--bg-elevated)] cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {e.source}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-[3px] bg-violet-500/15 text-violet-700 dark:text-violet-300 border border-violet-500/25 text-[11px]">
                          {e.relation}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {e.target}
                      </td>
                      <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400">
                        +0.20
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Floating Rounded-2xl Node Inspector Drawer (No Backdrop, Tight Margin, Flush Right Scroll) */}
      <AnimatePresence>
        {selectedNode && (
          <motion.aside
            key="graph-entity-drawer"
            role="dialog"
            aria-label={`Entity Inspector: ${selectedNode.name}`}
            initial={{ x: 440, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 440, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }}
            className="fixed top-2 bottom-2 right-2 z-50 w-[calc(100vw-16px)] max-w-[410px] rounded-2xl hairline-border flex flex-col justify-between shadow-2xl overflow-hidden"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-primary)' }}
          >
            {/* Drawer Header */}
            <div className="px-5 pt-4 pb-3.5 hairline-border-b flex items-start justify-between gap-2 shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <h2 className="text-base font-bold font-mono-data" style={{ color: 'var(--text-primary)' }}>
                    {selectedNode.name}
                  </h2>
                </div>
                <p className="text-xs mt-1 font-mono-data" style={{ color: 'var(--text-secondary)' }}>
                  type: {selectedNode.type} • ws:{selectedNode.workspace}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2 py-0.5 rounded-[3px] text-[10px] font-mono-data font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                  1-Hop Active
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedNodeId(null)}
                  className="p-1.5 rounded-lg hover:bg-[var(--bg-elevated)] transition-colors cursor-pointer"
                  style={{ color: 'var(--text-secondary)' }}
                  aria-label="Close entity inspector drawer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Flush Right Scrollable Body */}
            <div
              className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
              data-testid="graph-drawer-scroll"
            >
              {/* Connected Triplets */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    Connected Triplets ({connectedEdges.length})
                  </span>
                  <span className="font-mono-data text-[11px] text-emerald-600 dark:text-emerald-400">
                    +0.20 BFS Weight
                  </span>
                </div>

                <div className="space-y-2">
                  {connectedEdges.map((edge, idx) => (
                    <div
                      key={edge.id || idx}
                      className="p-2.5 rounded-[6px] hairline-border font-mono-data text-[11px] space-y-1.5"
                      style={{ backgroundColor: 'var(--bg-elevated)' }}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-semibold break-words" style={{ color: 'var(--text-primary)' }}>
                          {edge.source} → {edge.target}
                        </span>
                      </div>
                      <div>
                        <span className="inline-block px-1.5 py-0.5 rounded-[3px] bg-violet-500/15 text-violet-700 dark:text-violet-300 text-[10px]">
                          {edge.relation}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Linked Memories in SQLite WAL */}
              <div className="pt-3 hairline-border-t space-y-2.5">
                <div className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Linked Memories ({relatedMemories.length})
                </div>

                {relatedMemories.length === 0 ? (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    Entity linked via structural graph index. Click connected nodes to inspect direct memory payloads.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {relatedMemories.map((m) => (
                      <div
                        key={m.id}
                        className="p-3 rounded-[6px] hairline-border space-y-1.5 text-xs"
                        style={{ backgroundColor: 'var(--bg-elevated)' }}
                      >
                        <div className="flex items-center justify-between font-mono-data text-[10px]">
                          <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                            {m.id}
                          </span>
                          <span style={{ color: 'var(--text-muted)' }}>{m.type}</span>
                        </div>
                        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                          {m.content}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Drawer Footer */}
            <div
              className="px-5 py-3.5 hairline-border-t flex items-center justify-between text-[11px] font-mono-data shrink-0"
              style={{ color: 'var(--text-muted)' }}
            >
              <span className="flex items-center gap-1.5">
                <Network className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>SQLite Graph Triplets • BFS Depth = 1</span>
              </span>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                className="px-3 py-1 reui-btn-secondary text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
};
