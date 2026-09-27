import type { NextConfig } from 'next';
import { networkInterfaces } from 'node:os';

// Phones load the dev server through this machine's LAN address. Over HTTPS
// (HTTP/2) there is no Host header for vinext's same-origin check, so list the
// LAN addresses explicitly or the client bundle is blocked and nothing hydrates.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && !net.internal)
  .map((net) => net!.address);

const nextConfig: NextConfig = {
  allowedDevOrigins: lanAddresses,
};

export default nextConfig;
