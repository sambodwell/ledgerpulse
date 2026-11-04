/**
 * Pro unlock overrides. When active, every signed-in user is treated as Pro (full audit,
 * executive report, 12-month projection, scenario forecasting) on both the server and the
 * client, and the billing routes never call Stripe or demand Stripe/service-role keys.
 *
 *   NEXT_PUBLIC_DEV_UNLOCK=1          local `next dev` only — ignored in production builds.
 *   NEXT_PUBLIC_FORCE_PRO_UNLOCK=1    emergency override that ALSO applies to production builds
 *                                     (`next build` / `next start` / deployments). Anyone who can
 *                                     sign in gets Pro for free while it's set — remove it before launch.
 *
 * NEXT_PUBLIC_ values are inlined at build time: rebuild / restart after changing them.
 */
const DEV_FLAG = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEV_UNLOCK === "1";
export const FORCE_PRO_UNLOCK = process.env.NEXT_PUBLIC_FORCE_PRO_UNLOCK === "1";

export const DEV_UNLOCK = DEV_FLAG || FORCE_PRO_UNLOCK;
