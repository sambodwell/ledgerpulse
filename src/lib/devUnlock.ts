/**
 * Local-testing override: NEXT_PUBLIC_DEV_UNLOCK=1 treats every signed-in user as Pro
 * (full audit, executive report, 12-month projection, scenario forecasting) on both
 * the server and the client, so the app can be tested without Stripe.
 *
 * Never active in production builds: `next build` / `next start` and deployments run
 * with NODE_ENV=production, so a stray env var can't give away paid features.
 * The value is inlined at build time, so restart `next dev` after changing it.
 */
export const DEV_UNLOCK = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_UNLOCK === "1";
