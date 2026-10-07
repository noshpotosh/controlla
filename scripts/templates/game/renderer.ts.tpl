import type { GameRenderer, Presentation } from '../../api/index.ts';
import type { __CLASS__State } from './game.ts';

export class __CLASS__Renderer implements GameRenderer<__CLASS__State> {
  render({ context, width, height, snapshot }: Presentation<__CLASS__State>) {
    context.fillStyle = '#101820';
    context.fillRect(0, 0, width, height);
    context.font = '24px sans-serif';
    context.textAlign = 'center';
    snapshot.players.forEach((player, index) => {
      context.fillStyle = player.color;
      context.fillText(
        `${player.name}: ${snapshot.state?.scores[player.id] ?? 0}`,
        width / 2,
        60 + index * 36,
      );
    });
  }
  dispose() {}
}
