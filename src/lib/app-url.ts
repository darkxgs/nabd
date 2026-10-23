/** The public origin of this deployment, for links in alerts and the demo target. */
export function appUrl(): string {
  if (process.env.NABD_PUBLIC_URL) return process.env.NABD_PUBLIC_URL.replace(/\/$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Local development checks its own demo target on localhost, which the network guard would refuse. */
export const allowPrivateTargets = () => process.env.NABD_ALLOW_PRIVATE === "1" || (!process.env.VERCEL && process.env.NODE_ENV !== "production");
