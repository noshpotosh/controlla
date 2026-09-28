// Client-side half of the registry: control type → React view.
// Keep in step with registry.ts (tests/controls.test.ts checks this).
import type { ComponentType } from 'react';
import type { WidgetType } from '../core/types.ts';
import type { ControlViewProps } from './types.ts';
import { Button } from './button/Button.tsx';
import { Dpad } from './dpad/Dpad.tsx';
import { Stick } from './stick/Stick.tsx';
import { AimPad } from './aim-pad/AimPad.tsx';
import { SwipePad } from './swipe-pad/SwipePad.tsx';
import { HoldMeter } from './hold-meter/HoldMeter.tsx';

// Each view narrows its own props; the registry pairs them with the right defaults.
// oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous prop types
type AnyView = ComponentType<ControlViewProps<any>>;

export const views: Partial<Record<WidgetType, AnyView>> = {
  button: Button,
  dpad: Dpad,
  stick: Stick,
  'aim-pad': AimPad,
  'swipe-pad': SwipePad,
  'hold-meter': HoldMeter,
  // control:new inserts above this line
};
