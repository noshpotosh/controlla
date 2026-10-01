# Backlog

Outstanding Controlla work. Each line links to an item in
[`backlog/`](backlog/) that is defined well enough for an agent to build it
without help until on-device testing. The [backlog guide](backlog/README.md)
covers how to write, work and close items.

Items under **Ready** are in priority order, and the top one is next. To
reprioritize, move a line.

## Ready

- [BL-001 Latency and netcode architecture review](backlog/BL-001-latency-architecture-review.md):
  explain the cursor lag, late hits and lagging second screens; weigh server
  authority, rollback, tick-numbered input and edge hosting; recommend a target
  and draft the follow-up items.

## Draft

Items with open questions, listed in the item.

- [BL-002 Rebuild netcode to the reviewed target architecture](backlog/BL-002-netcode-rebuild.md):
  placeholder; BL-001 rewrites and splits it once you pick its recommendations.

## In progress

These statuses live on the item's branch (`feature/bl-NNN-…`), so on `develop`
they are usually empty. Run `git branch -a --list '*bl-*'` to see work in
flight.

_None._

## Needs testing

_None._

## Blocked

_None._

## Done

Newest first, with the date each item closed.

_None yet._

## Dropped

_None._
