'use client';
import { ControlFrame } from '../kit/ControlFrame.tsx';
import { useTrackedPointer } from '../kit/useTrackedPointer.ts';
import type { ControlViewProps } from '../types.ts';
import type { __PASCAL__Props } from './definition.ts';
import { __CAMEL__Value } from './logic.ts';

export function __PASCAL__({
  widget,
  port,
  props,
}: ControlViewProps<__PASCAL__Props>) {
  const { active, handlers } = useTrackedPointer({
    onStart() {
      port.haptic();
    },
    onMove(p) {
      port.value(__CAMEL__Value(p.x / p.width, p.y / p.height));
    },
  });
  return (
    <ControlFrame
      widget={widget}
      active={active}
      hint={props.hint}
      bare={props.bare}
      shape={props.shape}
      appearance={props.appearance}
      color={props.color}
      {...handlers}
    >
      <span className="ctl-__TYPE____body" />
    </ControlFrame>
  );
}
