# Local acceptance session — YYYY-MM-DD

Overall gate: **not run**. Allowed statuses: pass / fail / blocked / not run.
Unavailable hardware stays not run with a reason, never implicitly passed.

## Identity and setup

- Operator / observer:
- Tested commit and clean/dirty state (describe any diff):
- Frontend mode (development/production); Node/browser versions:
- Computer, OS, display model/resolution; Game Mode if applicable:
- Phone A: model, exact iOS version/build, Safari, orientation:
- Phone B: same fields or unavailable:
- LAN topology, Wi-Fi band, isolation, VPN/cellular state:
- Session start/end, HTTPS origin and signaling settings (no credentials):
- Certificate identity/fingerprint and phone/host trust confirmation:
- Preflight secure-context result and motion API availability:
- Firewall/trust changes and reversal instructions:
- External evidence directory (sensitive artifacts stay outside Git):
- Automated checks and exact candidate commit:

## Results

Copy rows per device and subcase. Do not combine distinct outcomes. Expand
steps where needed for another operator to reproduce.

| Case/subcase | Device + build | Status | Expected / actual | Route/candidates | Steps, duration and evidence file |
| --- | --- | --- | --- | --- | --- |
| HTTPS + join | | not run | Trusted secure context and roster | | |
| L01 | | not run | Cold start/roster/ready | | |
| L02-deny | | not run | Usable touch fallback | | |
| L02-grant | | not run | Actual sensor aiming | | |
| L03 | | not run | Calibration/recenter/orientation | | |
| L04 | | not run | Hold/press/cancel/multitouch | | |
| L05 | | not run | Round/rematch/abort ledger | | |
| L06-background | | not run | Recovery within grace | | |
| L06-lock | | not run | Recovery within grace | | |
| L06-reload | | not run | Recovery within grace | | |
| L06-expired | | not run | Understandable recovery after grace | | |
| L07 | | not run | Wi-Fi loss/return | | |
| L08 | | not run | Host loss/retained report | | |
| L09 | | not run | Fullscreen/audio/drift | | |
| Designer | | not run | Keyboard/pointer/readouts; clean console | n/a | |

## Defects and retest

For each: case ID, reproduction, expected/actual, severity, evidence, fixing
commit, regression check and affected-case retest result. Keep earlier failures
alongside successful retests. Redact resume identities/tokens and credentials.

## Coverage and cleanup

- Passed devices/cases:
- Failed, blocked and not-run cases with reasons:
- Reports retained before/after host loss; export inspection:
- Processes stopped; firewall rules removed; certificate trust/profile removed:
- Follow-up owner and required next action:

Not certified: Android, 4–8 phones, TVs, other households, TURN, cross-country
fairness, physical latency/jitter. Desktop simulation cannot close device rows.
