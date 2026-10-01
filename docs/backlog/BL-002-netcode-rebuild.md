# BL-002: Rebuild netcode to the reviewed target architecture

- **Depends on:** BL-001
- **Branch:** _set when work starts_
- **Areas:** engine, transport, runtime, server

> **Placeholder.** BL-001 rewrites this item into the first concrete change from
> its recommendations, and adds further items with new IDs. Don't work this item
> as written.

## Goal

Make the changes that the [latency review](BL-001-latency-architecture-review.md)
recommends and the user adopts. Aim lags the hand, hits land late and second
screens run behind, and these should measurably improve against the review's
baseline. The game should move toward running like a live-service game.

## Context

To be filled in from `docs/architecture/LATENCY-REVIEW.md` and
`docs/ADR-002.md` once BL-001 is done. The candidate directions are a
server-authoritative simulation, rollback or prediction, tick-numbered input
frames and edge hosting.

## Scope

In:

- To be decided after BL-001.

Out:

- To be decided after BL-001.

## Decisions

- Every change is measured against the BL-001 harness baseline, before and
  after.
- Hosting stays at or below about $10 a month at hobby scale, unless the user
  accepts a different figure from the review.

## Acceptance criteria

- [ ] To be written from the adopted recommendations.

## Implementation notes

None yet.

## Human test plan

To be written with the acceptance criteria.

## Open questions

- Which BL-001 recommendations are adopted, and in what order? This is answered
  after the review. The BL-001 agent then splits this item into concrete items.

## Handoff

_Filled in by the agent that builds this._

- **Branch / last commit:**
- **Checks:**
- **Not verified:**
- **Decisions made while building:**

## Test results

_Filled in after on-device testing: date, device, outcome of each step, and any
follow-ups._
