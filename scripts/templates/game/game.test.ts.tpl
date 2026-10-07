import assert from 'node:assert/strict';
import test from 'node:test';
import { GameHarness } from '../../devtools/game-harness/harness.ts';
import { __EXPORT__ } from './index.ts';

void test('__SLUG__ starter accepts semantic actions and finalizes once', async () => {
  const harness = new GameHarness(__EXPORT__, {
    sessionId: '__SLUG__-test',
    seed: 1,
  });
  try {
    await harness.load();
    harness.advance(3100);
    harness.press('ada', 'score');
    harness.finish();
    assert.equal(harness.error, null);
    assert.equal(harness.phase, 'results');
    assert.equal(harness.authoritativeSnapshot()!.state!.scores.ada, 1);
    const progress = harness.progressView();
    assert.equal(progress.rounds.length, 1);
    harness.finish();
    assert.deepEqual(harness.progressView(), progress);
  } finally {
    harness.dispose();
  }
});
