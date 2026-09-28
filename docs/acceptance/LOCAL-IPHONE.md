# Local iPhone functional acceptance

This runbook is for formal trusted-LAN acceptance, including route and latency
observations. For ordinary motion-control development without installing a
certificate profile, use [`npm run dev:phone`](../PHONE-DEVELOPMENT.md) instead.

Use one or two iPhones in Safari on the same trusted LAN as a computer/display,
running Neon Harvest, protocol 4. This does not certify Android, 4–8 phones,
TVs, TURN, another household, fairness or physical latency. Copy the
[results template](RESULTS-TEMPLATE.md) for each session. Record exact versions,
not “latest.” Every applicable case must pass on every tested phone to close
this local gate. Unavailable hardware remains explicitly not run.

## Build and evidence

Record `git rev-parse HEAD`, `git status --short`, Node version, computer/browser,
display, iPhone model, Settings → General → About → iOS Version, network and
date/time. Start from a clean checkpoint. Keep reports/photos/logs in an external
evidence directory; no resume tokens or raw reports in Git.

Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` for the
candidate. The build includes production bundle assertions. This session uses
the development frontend so tools can be checked; do not claim production
deployment acceptance.

## Temporary trusted HTTPS

Use Caddy from its official distribution. The checked-in
[proxy configuration](../../scripts/local-testing/Caddyfile.local-acceptance) binds the selected
LAN address on 8443 and distributes the public root on 8086. It does not install
trust, enable an admin listener, or request public certificates. No public tunnel,
router forwarding or TURN is needed.

Choose the computer's actual Wi-Fi/Ethernet IPv4 address (not localhost, a
container bridge or VPN). Set up once, substituting the LAN address:

```sh
export CONTROLLA_LAN_IP=192.168.1.20
export CONTROLLA_ACCEPTANCE_DIR="$(mktemp -d /tmp/controlla-acceptance.XXXXXX)"
mkdir -p "$CONTROLLA_ACCEPTANCE_DIR/private" "$CONTROLLA_ACCEPTANCE_DIR/public" "$CONTROLLA_ACCEPTANCE_DIR/evidence"
chmod 700 "$CONTROLLA_ACCEPTANCE_DIR/private"
export CONTROLLA_ACCEPTANCE_PUBLIC="$CONTROLLA_ACCEPTANCE_DIR/public"
export XDG_DATA_HOME="$CONTROLLA_ACCEPTANCE_DIR/private/data"
export XDG_CONFIG_HOME="$CONTROLLA_ACCEPTANCE_DIR/private/config"
cp scripts/local-testing/local-acceptance-preflight.html "$CONTROLLA_ACCEPTANCE_PUBLIC/preflight.html"
```

Reuse the same literal directory and environment values in other terminals;
do not generate a new CA directory for each command. Start separate foreground
processes from the repository:

```sh
# Terminal 1: frontend (Vite currently binds all interfaces).
SIGNAL_PORT=8906 npm run dev -- --port 3006
# Terminal 2: fresh isolated signaling process.
SIGNAL_PORT=8906 ALLOWED_ORIGINS="https://$CONTROLLA_LAN_IP:8443" npm run signal
# Terminal 3: prepend Caddy's absolute binary path if not on PATH.
caddy validate --config scripts/local-testing/Caddyfile.local-acceptance --adapter caddyfile
caddy run --config scripts/local-testing/Caddyfile.local-acceptance --adapter caddyfile
```

If a port is occupied, do not kill the existing service. Stop this setup and
choose a consistent unused port set in a local Caddyfile copy and all commands.
Do not accept Vite silently changing its port.

After Caddy starts, copy only the root certificate:

```sh
cp "$XDG_DATA_HOME/caddy/pki/authorities/local/root.crt" "$CONTROLLA_ACCEPTANCE_PUBLIC/controlla-test-root.crt"
openssl x509 -in "$CONTROLLA_ACCEPTANCE_PUBLIC/controlla-test-root.crt" -noout -subject -fingerprint -sha256
curl --cacert "$CONTROLLA_ACCEPTANCE_PUBLIC/controlla-test-root.crt" "https://$CONTROLLA_LAN_IP:8443/__acceptance"
```

On the iPhone, join the same trusted LAN and open
`http://LAN-IP:8086/controlla-test-root.crt` in Safari. Install the downloaded
profile in Settings → General → VPN & Device Management, then enable this
root under General → About → Certificate Trust Settings. Match the certificate
identity/fingerprint with the operator; distribute no private key. Establish
trust in the host browser through its certificate settings too. Bypassing a
certificate warning does not qualify.

References: Apple's [manual root-trust step](https://support.apple.com/en-us/102390),
Caddy's [internal TLS](https://caddyserver.com/docs/caddyfile/directives/tls) and
[trust controls](https://caddyserver.com/docs/caddyfile/options#skip-install-trust).

Open `https://LAN-IP:8443/__acceptance` on the iPhone: require **Secure context:
YES**, no warning, and record motion API availability. This does not prove
permission or samples. Open the host through the same HTTPS origin, create a
room and use its phone link. Successful join/roster verifies the actual `/signal`
WebSocket path; require this before testing sensors.

Do not disable the firewall. If blocked, record its current state and add only
a scoped temporary LAN rule for TCP 8443/8086 and the WebRTC route required by
this run; record the change and reversal. Vite and signaling currently bind all
interfaces: use only a trusted private LAN without public port forwarding.
Record VPN, guest isolation and cellular fallback. A P2P label alone does not
prove the route is local.

## Cases — repeat for each phone

| ID | Procedure | Required observation |
| --- | --- | --- |
| L01 | Cold-start host/Safari; join one phone, then a second if available. | Correct room, roster, identity and ready controls; record candidates/routes. Absent second-phone coverage stays not run. |
| L02 | Deny Enable motion and use aim-pad/PULSE. Reset the site's permission if needed and explicitly grant it; record exact Safari reset steps. | Denial leaves usable touch input; grant produces actual sensor aiming. API presence alone is insufficient. If reset is unavailable, block that subcase. |
| L03 | Calibrate center/TL/TR/BR/BL; aim at corners/edges from centered and off-center seats. Recenter without refitting; rotate and return. | Correct directions, retained fit and usable controls after rotation. Record seat angle, drift and recenter needs over several rounds. |
| L04 | Hold aim with one finger; press/hold PULSE with another. Lift/cancel touch and switch focus. | Stable held position, one activation per press, no repeats/stuck input or unwanted reset. |
| L05 | Complete round/rematch; record score, award and total. Abort another round. | Matching results/standings; abort awards nothing. Export and inspect completed/aborted records. |
| L06 | Separately background, lock and reload; return within 60 seconds. Repeat absence beyond grace. | Within grace: same name/seat/color/calibration, fresh ready state, working input, no stale actions. Beyond grace: understandable recovery, not guaranteed identity. Record duration and whether Safari stayed connected. |
| L07 | Briefly disable phone Wi-Fi, then restore it; keep host visible. | Visible loss/recovery, no stuck input, working controls. Record route and degraded fallback. Cellular continuation is not a disconnected trial. |
| L08 | Join an additional display in a separate computer browser context; close host after completion. | Display/phone show session ended; display retains results and exports report. Second window is software evidence, not another physical venue. |
| L09 | Exercise fullscreen/audio; observe whole-session drift. | Record actual behavior and gesture requirements; no unexplained input loss on return. |

For every subcase record pass/fail/blocked/not run, expected/actual behavior,
route, build, device and artifact. Do not combine a passed denial test and an
unperformed grant test into a permission pass. Save defect reproduction/evidence,
make focused fixes with appropriate regression coverage, and repeat affected
cases against the new commit.

## Designer browser gate

Open `/?role=designer`. Tab from New layout to Open Aim and fire and then Edit;
decorative controls must not receive focus. Check visible focus, Enter, Space
and thumbnail pointer activation against the correct layouts. In Aim and pulse
play mode and `/?role=preview&layout=aim-and-pulse`, exercise aim/PULSE and read
values/counts. Check console for nesting/hydration errors. Use a portrait viewport
for standalone preview. Do not save layout changes just to run these checks.

## Completion and cleanup

Keep original reports before/after host loss outside Git. Commit a sanitized
summary with case IDs, tested commit and unresolved failures. Archive evidence
before deleting temporary directories. Stop only this session's processes;
remove its firewall rules and certificate trust/profile on every test device
and browser. Record completion; preserve other sessions' trust/settings.

Physical p50/p95/p99 and jitter remain unverified. Existing monitor/TV latency
targets are unchanged; software timing cannot close them.
