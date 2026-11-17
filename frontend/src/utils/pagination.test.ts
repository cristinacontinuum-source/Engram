import test from 'node:test';
import assert from 'node:assert/strict';
import { getVisiblePageNumbers, paginateItems } from './pagination';

test('paginateItems slices items accurately and clamps out-of-range pages', () => {
  const data = Array.from({ length: 12 }, (_, i) => i + 1);

  const page1 = paginateItems(data, 1, 5);
  assert.deepEqual(page1.items, [1, 2, 3, 4, 5]);
  assert.equal(page1.totalPages, 3);
  assert.equal(page1.startItem, 1);
  assert.equal(page1.endItem, 5);

  const page3 = paginateItems(data, 3, 5);
  assert.deepEqual(page3.items, [11, 12]);
  assert.equal(page3.currentPage, 3);
  assert.equal(page3.startItem, 11);
  assert.equal(page3.endItem, 12);

  // Clamps past max page & below 1
  const clampedHigh = paginateItems(data, 99, 5);
  assert.equal(clampedHigh.currentPage, 3);
  const clampedLow = paginateItems(data, -4, 5);
  assert.equal(clampedLow.currentPage, 1);

  // Handles empty list cleanly
  const empty = paginateItems([], 2, 5);
  assert.equal(empty.totalPages, 1);
  assert.equal(empty.currentPage, 1);
  assert.equal(empty.startItem, 0);
  assert.equal(empty.endItem, 0);
});

test('getVisiblePageNumbers handles small counts directly and inserts ellipsis for many pages', () => {
  assert.deepEqual(getVisiblePageNumbers(1, 3), [1, 2, 3]);
  assert.deepEqual(getVisiblePageNumbers(5, 10), [1, 'ellipsis', 4, 5, 6, 'ellipsis', 10]);
});
