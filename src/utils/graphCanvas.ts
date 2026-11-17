export interface Point2D {
  x: number;
  y: number;
}

export const GRAPH_MIN_ZOOM = 0.45;
export const GRAPH_MAX_ZOOM = 1.8;

export function clampZoom(zoom: number): number {
  return Math.min(GRAPH_MAX_ZOOM, Math.max(GRAPH_MIN_ZOOM, Number(zoom.toFixed(3))));
}

export function computeCursorAnchoredZoom(params: {
  currentZoom: number;
  currentPan: Point2D;
  deltaY: number;
  pointerX: number;
  pointerY: number;
}): { zoom: number; pan: Point2D } {
  const { currentZoom, currentPan, deltaY, pointerX, pointerY } = params;
  // Normalize wheel speed smoothly across mouse wheel & trackpad gestures
  const zoomStep = -Math.sign(deltaY) * Math.min(0.14, Math.max(0.04, Math.abs(deltaY) * 0.001));
  const nextZoom = clampZoom(currentZoom * (1 + zoomStep));
  if (nextZoom === currentZoom) {
    return { zoom: currentZoom, pan: currentPan };
  }

  const ratio = nextZoom / currentZoom;
  return {
    zoom: nextZoom,
    pan: {
      x: Number((pointerX - (pointerX - currentPan.x) * ratio).toFixed(2)),
      y: Number((pointerY - (pointerY - currentPan.y) * ratio).toFixed(2)),
    },
  };
}

export function isDragGesture(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  thresholdPx = 5
): boolean {
  const dx = currentX - startX;
  const dy = currentY - startY;
  return Math.hypot(dx, dy) >= thresholdPx;
}
