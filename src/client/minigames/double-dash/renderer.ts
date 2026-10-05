import type { GameRenderer, Presentation } from '../../api/index.ts';
import type { DoubleDashState } from './game.ts';

/** The game stays inside the room stage; removing it terminates its workers. */
export class DoubleDashRenderer implements GameRenderer<DoubleDashState> {
  private frame: HTMLIFrameElement | null = null;
  private lastSent = -Infinity;
  render({
    context,
    snapshot,
    time,
    width,
    height,
  }: Presentation<DoubleDashState>) {
    if (!this.frame) {
      const parent = context.canvas.parentElement;
      if (!parent) return;
      const frame = document.createElement('iframe');
      frame.title = 'Mario Kart: Double Dash!! game screen';
      frame.src =
        '/__double-dash/?embed=1&core=upstream&video=software&cpu=single&fastsw=0&wasmjit=1&presenter=2d';
      frame.allow = 'autoplay; fullscreen';
      Object.assign(frame.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        border: '0',
        background: '#030503',
      });
      parent.append(frame);
      this.frame = frame;
    }
    context.fillStyle = '#030503';
    context.fillRect(0, 0, width, height);
    // Re-send while the runtime starts, then keep held inputs and releases fresh.
    if (time - this.lastSent >= 30) {
      this.frame.contentWindow?.postMessage(
        {
          type: 'controlla:kart-input',
          controllers: snapshot.state?.controllers ?? [],
        },
        location.origin,
      );
      this.lastSent = time;
    }
  }
  dispose() {
    this.frame?.remove();
    this.frame = null;
  }
}
