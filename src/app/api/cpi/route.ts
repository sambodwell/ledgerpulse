/**
 * GET /api/cpi — latest year-over-year US inflation (CPI-U, all items, not seasonally adjusted) from the
 * Bureau of Labor Statistics public API. Used as the default inflation rate for projections; the owner can
 * override it with a custom rate. Falls back to DEFAULT_INFLATION_RATE when BLS is unreachable.
 *
 * No user data is sent anywhere: this is a public, keyless series lookup, cached for a day.
 */

import { cacheLife } from "next/cache";
import { DEFAULT_INFLATION_RATE, type CpiReading } from "@/lib/schemas";

const SERIES = "CUUR0000SA0";
const BLS_URL = `https://api.bls.gov/publicAPI/v1/timeseries/data/${SERIES}`;

interface BlsPoint {
  year: string;
  period: string; // "M01".."M12", "M13" = annual average
  periodName: string;
  value: string;
}

async function latestCpi(): Promise<CpiReading> {
  "use cache";
  try {
    const res = await fetch(BLS_URL, { signal: AbortSignal.timeout(6000), headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`BLS ${res.status}`);
    const body = (await res.json()) as { status?: string; Results?: { series?: { data?: BlsPoint[] }[] } };
    const data = (body.Results?.series?.[0]?.data ?? []).filter((d) => /^M(0[1-9]|1[0-2])$/.test(d.period) && Number.isFinite(Number(d.value)));
    const latest = data[0];
    const yearAgo = latest && data.find((d) => d.period === latest.period && Number(d.year) === Number(latest.year) - 1);
    if (!latest || !yearAgo) throw new Error("BLS series incomplete");
    const rate = Math.round((Number(latest.value) / Number(yearAgo.value) - 1) * 10000) / 10000;
    if (!Number.isFinite(rate) || rate < -0.1 || rate > 0.3) throw new Error("BLS value out of range");
    cacheLife("days");
    return { rate, period: `${latest.periodName.slice(0, 3)} ${latest.year}`, source: "BLS CPI-U", live: true };
  } catch (e) {
    console.warn("[cpi] falling back to default rate:", e instanceof Error ? e.message : e);
    // Retry soon rather than pinning the fallback for a day.
    cacheLife("minutes");
    return { rate: DEFAULT_INFLATION_RATE, period: null, source: "Default assumption", live: false };
  }
}

export async function GET() {
  return Response.json(await latestCpi());
}
