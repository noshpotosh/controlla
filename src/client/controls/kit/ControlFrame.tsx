'use client';
// The shared shell every control renders inside. It owns the chrome that must
// look identical everywhere: material, shape, appearance, caption, hint,
// active state, variant class and focus ring. Controls only draw their play
// area. See docs/design/CONTROLLER-DESIGN.md.
import type { HTMLAttributes, ReactNode } from 'react';
import type { ControlAppearance, ControlShape, Widget } from '../api.ts';

export interface ControlFrameProps extends HTMLAttributes<HTMLElement> {
  /** Render as a native <button> for controls that are one big button. */
  as?: 'div' | 'button';
  widget: Widget;
  active?: boolean;
  hint?: string;
  bare?: boolean;
  shape?: ControlShape;
  appearance?: ControlAppearance;
  children: ReactNode;
}

export function ControlFrame({
  as: Tag = 'div',
  widget,
  active = false,
  hint,
  bare = false,
  shape = 'rounded',
  appearance = 'plain',
  className,
  children,
  ...rest
}: ControlFrameProps) {
  return (
    <Tag
      {...(Tag === 'button' && { type: 'button' as const })}
      {...rest}
      className={[
        'ctl-frame',
        `ctl-${widget.type}`,
        widget.variant && `ctl--${widget.variant}`,
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      data-active={active || undefined}
      data-shape={shape}
      data-appearance={appearance}
      aria-label={rest['aria-label'] ?? widget.label}
    >
      {children}
      {!bare && widget.label && (
        <span className="ctl-frame__label" aria-hidden>
          {widget.label}
        </span>
      )}
      {!bare && hint && (
        <span className="ctl-frame__hint" aria-hidden>
          {hint}
        </span>
      )}
    </Tag>
  );
}
