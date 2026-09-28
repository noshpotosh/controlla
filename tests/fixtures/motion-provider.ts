import {
  Motion,
  type MotionEnvironment,
} from '../../src/client/controls/motion/provider.ts';
import type { MotionEventLike } from '../../src/client/controls/motion/trace.ts';
import { defaultCapabilities } from '../../src/client/controls/resolve.ts';
import type { Permission } from '../../src/client/controls/api.ts';

export function motionFixture(
  permission: () => Promise<Permission> = async () => 'granted',
  supported = true,
) {
  let time = 0,
    requests = 0,
    starts = 0,
    stops = 0;
  let receive: ((event: MotionEventLike) => void) | null = null;
  const timers = new Set<{ at: number; run: () => void }>();
  const env: MotionEnvironment = {
    now: () => time,
    supported: () => supported,
    requestPermission: () => {
      requests++;
      return permission();
    },
    capabilities: defaultCapabilities,
    listen: (listener) => {
      starts++;
      receive = listener;
      return () => {
        stops++;
        receive = null;
      };
    },
    schedule: (run, delay) => {
      const timer = { at: time + delay, run };
      timers.add(timer);
      return () => {
        timers.delete(timer);
      };
    },
  };
  const motion = new Motion(env);
  return {
    motion,
    counts: () => ({ requests, starts, stops, timers: timers.size }),
    listener: () => receive,
    advance(ms: number) {
      const end = time + ms;
      while (true) {
        const next = [...timers]
          .filter((timer) => timer.at <= end)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        time = next.at;
        timers.delete(next);
        next.run();
      }
      time = end;
    },
    emit(overrides: Partial<MotionEventLike> = {}) {
      receive?.({
        timeStamp: time,
        accelerationIncludingGravity: { x: 0, y: 0, z: 9.81 },
        rotationRate: { alpha: 0, beta: 0, gamma: 0 },
        ...overrides,
      });
    },
  };
}
