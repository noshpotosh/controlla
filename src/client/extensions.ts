import type { ComponentType, ReactNode } from 'react';
import type { MotionDiagnosticsPort } from './shell/ports.ts';
export type { MotionDiagnosticsPort } from './shell/ports.ts';

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
