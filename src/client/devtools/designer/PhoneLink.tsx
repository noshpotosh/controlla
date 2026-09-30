'use client';
// "Test on phone": a QR code for the preview route on this machine's LAN
// address (localhost means nothing to a phone).
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { publicOrigin } from '../../shell/public-origin.ts';

export function PhoneLink({ layoutId }: { layoutId: string }) {
  const [url, setUrl] = useState<string | null>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let live = true;
    void publicOrigin().then((origin) => {
      if (live) setUrl(`${origin}/?role=preview&layout=${layoutId}`);
    });
    return () => {
      live = false;
    };
  }, [layoutId]);
  useEffect(() => {
    if (url && canvas.current)
      void QRCode.toCanvas(canvas.current, url, {
        margin: 1,
        width: 220,
        color: { dark: '#111427', light: '#fff9e8' },
      });
  }, [url]);
  return (
    <div className="dz-phone-link">
      <canvas
        ref={canvas}
        width={220}
        height={220}
        aria-label="QR code for the phone preview"
      />
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
      ) : (
        <p className="dz-muted">Finding this computer’s address…</p>
      )}
      <p className="dz-muted">
        Scan with your phone (same Wi-Fi). It updates every time the layout
        saves. Accept the certificate warning if you’re on the HTTPS dev server.
      </p>
    </div>
  );
}
