import os from "os";
import type { NextConfig } from "next";

/**
 * Allow LAN devices (e.g. http://10.23.61.226:3000 from another machine/phone)
 * to load dev assets. Next 16 blocks cross-origin dev requests by default,
 * which makes the page hang forever ("buffering") when opened via a LAN IP.
 * We auto-detect every local IPv4 interface; add more via DEV_ORIGINS=a,b,c.
 */
function lanOrigins(): string[] {
  const hosts: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni && ni.family === "IPv4" && !ni.internal) hosts.push(ni.address);
    }
  }
  const extra = (process.env.DEV_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set([...hosts, ...extra]));
}

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: lanOrigins(),
  // Hide the Next.js dev-tools button in the bottom-left corner — it overlaps
  // the ShortsPilot assistant FAB (dev mode only).
  devIndicators: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
