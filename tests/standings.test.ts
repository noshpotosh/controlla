import assert from 'node:assert/strict';
import test from 'node:test';
import { standingsForPresentation } from '../src/client/standings.ts';

void test('standings retain a returning nonparticipant’s points after the current results become visible', () => {
  const ledger = { revision: 6, totals: { ada: 4, bea: 3, cy: 9 } };
  const sampled = {
    revision: 6,
    totals: { ada: 4, bea: 3 },
    awards: { ada: 1, bea: 0 },
  };
  const totals = standingsForPresentation(ledger, sampled, 'results');
  assert.deepEqual(totals, { ada: 4, bea: 3, cy: 9 });
  assert.ok(Object.isFrozen(totals));
  assert.notEqual(totals, ledger.totals);
});

void test('a reliable future revision cannot reveal awards before sampled results', () => {
  const ledger = { revision: 7, totals: { ada: 5, bea: 3, cy: 9 } };
  const before = { revision: 6, totals: { ada: 4, bea: 3 }, awards: {} };
  assert.deepEqual(standingsForPresentation(ledger, before, 'results'), {
    ada: 4,
    bea: 3,
  });
  assert.deepEqual(
    standingsForPresentation(
      ledger,
      { ...before, revision: 7, totals: { ada: 5, bea: 3 } },
      'results',
    ),
    ledger.totals,
  );
});

void test('sampled totals override an older ledger and full hydration is visible only in the initial lobby without a sample', () => {
  const ledger = { revision: 4, totals: { ada: 2, cy: 9 } };
  const sampled = { revision: 6, totals: { ada: 4, bea: 3 }, awards: {} };
  assert.deepEqual(standingsForPresentation(ledger, sampled, 'running'), {
    ada: 4,
    bea: 3,
    cy: 9,
  });
  assert.deepEqual(
    standingsForPresentation(ledger, null, 'lobby'),
    ledger.totals,
  );
  assert.deepEqual(standingsForPresentation(ledger, null, 'loading'), {});
});
