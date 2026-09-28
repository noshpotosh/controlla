/** UI props for control views. Shared controller contracts live in api.ts. */
import type {
  ControlAppearance,
  ControlPort,
  ControlShape,
  Widget,
} from './api.ts';

/** Props every control view receives. */
export interface ControlViewProps<P extends object = object> {
  widget: Widget;
  port: ControlPort;
  props: P & CommonProps;
}

/** Props shared by every control, settable from a game's input requirements. */
export interface CommonProps {
  hint?: string;
  /** Hide the caption/hint chrome (e.g. very small slots). */
  bare?: boolean;
  /** Frame silhouette; one of the definition's `shapes`. */
  shape?: ControlShape;
  /** Resting colour treatment; one of the definition's `appearances`. */
  appearance?: ControlAppearance;
}
