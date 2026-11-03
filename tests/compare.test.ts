import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareLines, risenSkus, sameAsBefore, stockOf } from '../src/lib/compare.ts';

const line = (sku_id: string, shelf: number, warehouse: number, sold_cases = 0) => ({ sku_id, shelf, warehouse, sold_cases });
const skus = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

test('stock is shelf plus warehouse', () => {
  assert.equal(stockOf(line('a', 3, 4)), 7);
});

test('a line rose only when total stock is higher; a shelf/warehouse swap is not a rise', () => {
  const rows = compareLines(skus, [line('a', 5, 2), line('b', 2, 5), line('c', 1, 0)], [line('a', 3, 2), line('b', 5, 2)]);
  assert.deepEqual(rows.map((r) => r.rose), [true, false, false]);
  assert.equal(rows[2].before, null);
});

test('risenSkus keeps catalogue order', () => {
  assert.deepEqual(risenSkus(skus, [line('c', 9, 0), line('a', 9, 0)], [line('a', 1, 0), line('c', 1, 0)]), ['a', 'c']);
});

test('same numbers: every stocked SKU identical on both visits', () => {
  assert.equal(sameAsBefore([line('a', 3, 2, 1), line('b', 0, 0)], [line('a', 3, 2, 4), line('b', 0, 0)]), true);
});

test('same numbers: a SKU stocked only on the visit before breaks the match', () => {
  assert.equal(sameAsBefore([line('a', 3, 2), line('b', 0, 0)], [line('a', 3, 2), line('b', 4, 0)]), false);
});

test('same numbers: all-zero visits and a missing base never match', () => {
  assert.equal(sameAsBefore([line('a', 0, 0)], [line('a', 0, 0)]), false);
  assert.equal(sameAsBefore([line('a', 3, 2)], []), false);
});
