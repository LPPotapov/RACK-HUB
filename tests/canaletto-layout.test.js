import assert from 'node:assert/strict';
import test from 'node:test';
import { splitForTwoColumnDisplay } from '../src/canaletto/layout.js';

test('splitForTwoColumnDisplay splits 32 ranked rows into 1-16 / 17-32 without re-sorting', () => {
  const rows = Array.from({ length: 32 }, (_, i) => ({ rank: i + 1, name: `P${i + 1}` }));
  const [left, right] = splitForTwoColumnDisplay(rows);
  assert.equal(left.length, 16);
  assert.equal(right.length, 16);
  assert.deepEqual(left.map((r) => r.rank), Array.from({ length: 16 }, (_, i) => i + 1));
  assert.deepEqual(right.map((r) => r.rank), Array.from({ length: 16 }, (_, i) => i + 17));
  // Order preserved exactly — no re-sort.
  assert.deepEqual([...left, ...right], rows);
});

test('splitForTwoColumnDisplay handles an odd count by giving the extra row to the left column', () => {
  const rows = Array.from({ length: 7 }, (_, i) => ({ rank: i + 1 }));
  const [left, right] = splitForTwoColumnDisplay(rows);
  assert.equal(left.length, 4);
  assert.equal(right.length, 3);
});

test('splitForTwoColumnDisplay handles a small/empty roster gracefully', () => {
  assert.deepEqual(splitForTwoColumnDisplay([]), [[], []]);
  const [left, right] = splitForTwoColumnDisplay([{ rank: 1 }]);
  assert.equal(left.length, 1);
  assert.equal(right.length, 0);
});
