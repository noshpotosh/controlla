import type { ComponentType, ReactNode } from 'react';
import type { Permission } from '../core/types.ts';
import type { RawMotionSample } from '../core/motion/trace.ts';
import type { Motion } from './motion.ts';

/** Observation-only access; extensions receive no session or transport object. */
export interface MotionDiagnosticsPort {
  start(): void;
  subscribe(listener: (sample: RawMotionSample) => void): () => void;
  recentSamples(): RawMotionSample[];
  permission(): Permission;
}
export interface ControllerPanelProps {
  motion: MotionDiagnosticsPort;
  onClose: () => void;
}
export interface AppExtensions {
  homeNavigation?: ReactNode;
  controllerPanel?: {
    label: string;
    Component: ComponentType<ControllerPanelProps>;
  };
}
export function motionDiagnostics(
  source: Pick<Motion, 'start' | 'onSample' | 'samples' | 'capabilities'>,
): MotionDiagnosticsPort {
  return {
    start: () => source.start(),
    subscribe: (listener) =>
      source.onSample((sample) => listener(structuredClone(sample))),
    recentSamples: () => structuredClone(source.samples.toArray()),
    permission: () => source.capabilities.sensors.gyro.permission,
  };
}
