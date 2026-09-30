# Fast phone development

Use the temporary HTTPS workflow when developing phone motion controls. It
provides a browser-trusted URL without installing a certificate profile on the
phone or creating a hosting account.

```sh
npm ci
npm run dev:phone
```

The command starts the frontend, room service, and a Cloudflare Quick Tunnel.
Wait for **Phone development is ready**, then open the printed
`https://…trycloudflare.com` URL on the laptop and start a game there, so the
screen's QR code and invite link use the public HTTPS origin. On the phone,
scan the QR code (or open the invite link), join, tap **Enable motion**, and
grant the browser's motion permission. Stop the entire stack with Ctrl+C.

No Cloudflare account, DNS configuration, local CA, phone profile, or router
port-forwarding is required. The first run uses the repository's pinned
Wrangler dependency and may take longer while its tunnel binary is prepared.

## Local Wi-Fi play without a tunnel

To play on phones over your own network, with nothing routed through the
internet, run:

```sh
npm run dev:lan
```

It serves the frontend over HTTPS with a self-signed certificate on the
computer's LAN address, starts a room service that accepts that exact origin,
and prints a URL such as `https://10.0.0.90:3012`. Open it on the laptop, create
the room there, and join from phones on the same Wi-Fi. Each browser warns about
the certificate once; on iPhone tap **Show Details → visit this website**, then
**Enable motion** as usual. `npm run dev:lan` and `npm run dev:phone` use the same
ports and cannot run at the same time as each other or as `npm run dev`.

A bypassed certificate warning is fine for gameplay testing but is not evidence
for trusted-HTTPS acceptance; use the [local iPhone acceptance runbook](acceptance/LOCAL-IPHONE.md)
for that.

## What this workflow is for

The tunnel is an everyday functional-development convenience. Its URL is random
and lasts only while the command runs. Traffic travels through Cloudflare, so it
must not be used to claim LAN routing, offline behavior, direct peer paths, or
physical latency. Use the [local iPhone acceptance runbook](acceptance/LOCAL-IPHONE.md)
when those properties matter.

The development server accepts only `trycloudflare.com` tunnel hostnames in
addition to its normal local hosts. The room service accepts only the exact
random origin printed for the current run. Anyone who has that URL can reach the
development app while it is running, so do not use real secrets or leave it
running unattended.

## Ports and troubleshooting

The workflow uses frontend port `3012` and signaling port `8912` by default. If
either is occupied, stop the conflicting process or choose alternatives:

```sh
PHONE_DEV_PORT=3013 PHONE_SIGNAL_PORT=8913 npm run dev:phone
```

- If tunnel creation fails, confirm the laptop has internet access and rerun the
  command. Quick Tunnels are a development service and have no uptime guarantee.
- If the phone page loads but cannot create a room, stop the command and start it
  again; always use the newly printed URL.
- If motion remains unavailable, open the controller menu, tap **Enable motion**,
  and inspect the browser's site permissions. The page must remain on the printed
  HTTPS origin.
- If the frontend reports that another Vinext server is running, stop that
  repository's other `npm run dev` process before starting this workflow.
