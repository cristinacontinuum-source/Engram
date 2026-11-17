import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clampZoom,
  computeCursorAnchoredZoom,
  GRAPH_MAX_ZOOM,
  GRAPH_MIN_ZOOM,
  isDragGesture,
} from './graphCanvas';

test('clampZoom respects min and max graph zoom bounds', () => {
  assert.equal(clampZoom(0.1), GRAPH_MIN_ZOOM);
  assert.equal(clampZoom(3.5), GRAPH_MAX_ZOOM);
  assert.equal(clampZoom(1.15), 1.15);
});

test('computeCursorAnchoredZoom zooms in on negative deltaY and keeps pointer anchored', () => {
  const result = computeCursorAnchoredZoom({
    currentZoom: 1,
    currentPan: { x: 40, y: 60 },
    deltaY: -120,
    pointerX: 440,
    pointerY: 260,
  });

  assert.ok(result.zoom > 1);
  // World coordinate under cursor should remain invariant before/after zoom
  const worldBeforeX = (440 - 40) / 1;
  const worldBeforeY = (260 - 60) / 1;
  const worldAfterX = (440 - result.pan.x) / result.zoom;
  const worldAfterY = (260 - result.pan.y) / result.zoom;
  assert.ok(Math.abs(worldBeforeX - worldAfterX) < 0.05);
  assert.ok(Math.abs(worldBeforeY - worldAfterY) < 0.05);
});

test('computeCursorAnchoredZoom zooms out on positive deltaY', () => {
  const result = computeCursorAnchoredZoom({
    currentZoom: 1,
    currentPan: { x: 40, y: 60 },
    deltaY: 120,
    pointerX: 300,
    pointerY: 200,
  });

  assert.ok(result.zoom < 1);
});

test('isDragGesture distinguishes small clicks from drags >= 5px', () => {
  assert.equal(isDragGesture(100, 100, 102, 103, 5), false);
  assert.equal(isDragGesture(100, 100, 106, 100, 5), true);
  assert.equal(isDragGesture(100, 100, 103, 104, 5), true);
});
