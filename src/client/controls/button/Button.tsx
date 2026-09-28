'use client';
import type { KeyboardEvent } from 'react';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import { ICONS } from '../kit/icons.ts';
import { useTrackedPointer } from '../kit/useTrackedPointer.ts';
import type { ControlViewProps } from '../types.ts';
import type { ButtonProps } from './definition.ts';

export function Button({ widget, port, props }: ControlViewProps<ButtonProps>) {
  const Icon = props.icon ? ICONS[props.icon] : null;
  const { active, handlers } = useTrackedPointer({
    onStart() {
      port.press(true);
      port.haptic();
    },
    onEnd() {
      port.press(false);
    },
  });
  const key = (down: boolean) => (e: KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat) port.press(down);
  };
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      shape={props.shape}
      appearance={props.appearance}
      color={props.color}
      as="button"
      aria-pressed={active}
      onKeyDown={key(true)}
      onKeyUp={key(false)}
      {...handlers}
    >
      <span className="ctl-button__glyph">
        {Icon ? <Icon strokeWidth={2} /> : widget.label.slice(0, 1)}
      </span>
    </ControlFrame>
  );
}
