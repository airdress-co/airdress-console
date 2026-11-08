// The network view's data model (SPEC-189, RDR-092): nodes of five kinds in
// fixed lanes, associations as intervals, and point events. A spike-time
// shape: the operator's real wire format is SPEC-189 phase C.

export const KINDS = ['person', 'identity', 'device', 'session', 'host'] as const;
export type Kind = (typeof KINDS)[number];

export interface NetNode {
  readonly id: string;
  readonly kind: Kind;
  readonly label: string;
}

/** `used` is exercised (a session leg); `could` is standing access. */
export type EdgeStyle = 'used' | 'could';
export type ClosedBy = 'event' | 'sweep' | 'unconfirmed';

export interface NetEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly style: EdgeStyle;
  /** Epoch ms; may lie before the window, which then shows it as open on the left. */
  readonly start: number;
  /** Epoch ms, or null while it still holds at the window end. */
  readonly end: number | null;
  readonly closedBy: ClosedBy | null;
}

export interface NetEvent {
  readonly t: number;
  readonly name: string;
  readonly edge: string;
}

export interface Network {
  readonly from: number;
  readonly to: number;
  readonly nodes: readonly NetNode[];
  readonly edges: readonly NetEdge[];
  readonly events: readonly NetEvent[];
}
