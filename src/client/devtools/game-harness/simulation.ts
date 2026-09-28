import { kindOf, usesPressSlot } from '../../../controls/registry.ts';
import type { GameHarness } from './harness.ts';
import type { Point } from '../../api/index.ts';

/** Generic scripted players exercise the selected controls without knowing a game ID. */
export function driveSimulatedPlayers(harness: GameHarness, mouse?: Point) {
  harness.players.forEach((player, index) => {
    for (const widget of harness.configs[player.id].widgets) {
      if (kindOf(widget.type) === 'vector') {
        const x = Math.sin(harness.time / (1000 + index * 240) + index);
        const y = Math.cos(harness.time / (1300 + index * 180) + index);
        const value =
          widget.space === 'normalized'
            ? index === 0 && mouse
              ? mouse
              : { x: 0.5 + 0.35 * x, y: 0.5 + 0.3 * y }
            : { x: x * 0.6, y: y * 0.6 };
        harness.setValue(player.id, widget.action, value);
      }
      if (
        usesPressSlot(widget.type) &&
        harness.time >= harness.startAt &&
        (harness.time - index * 160) % 800 === 0
      )
        harness.press(player.id, widget.action);
    }
  });
}
