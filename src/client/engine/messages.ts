export type Channel = 'ctrl' | 'input' | 'snapshot' | 'events';
// Extensible wire envelopes are validated by role and message handlers at ingress.
// oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous JSON wire envelope
export type Message = { type: string; [key: string]: any };
