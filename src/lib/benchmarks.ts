/**
 * Industry benchmark & peer comparison. Pure and deterministic.
 *
 * Each peer group defines a handful of ratios (share of recurring monthly revenue) with the typical range seen for
 * that kind of business. The owner's recurring line items are bucketed by category / label keywords and compared,
 * giving a status chip per metric: Healthy, Watch, High or Low.
 *
 * The ranges are general rules of thumb for small operators, not audited industry statistics — the UI says so.
 */

import { round2, sum, type BusinessType, type ExpenseLine, type RevenueLine } from "@/lib/schemas";

export const BENCHMARK_PROFILES = ["DIGITAL_AGENCY", "ECOMMERCE", "FIELD_SERVICES", "REAL_ESTATE", "GENERAL_SMB", "HOUSEHOLD"] as const;
export type BenchmarkProfile = (typeof BENCHMARK_PROFILES)[number];

export const BENCHMARK_PROFILE_LABELS: Record<BenchmarkProfile, string> = {
  DIGITAL_AGENCY: "Digital Agency / Freelance",
  ECOMMERCE: "E-Commerce / Online Retail",
  FIELD_SERVICES: "Field Services (HVAC, plumbing, landscaping)",
  REAL_ESTATE: "Real Estate / Rental Property",
  GENERAL_SMB: "General Small Business",
  HOUSEHOLD: "Household Budget (50/30/20)",
};

export const BUSINESS_BENCHMARK_PROFILES = BENCHMARK_PROFILES.filter((p) => p !== "HOUSEHOLD");

export function defaultBenchmarkProfile(bt: BusinessType): BenchmarkProfile {
  switch (bt) {
    case "AGENCY_FREELANCE":
      return "DIGITAL_AGENCY";
    case "FIELD_SERVICE":
      return "FIELD_SERVICES";
    case "REAL_ESTATE":
      return "REAL_ESTATE";
    case "PERSONAL_FAMILY":
      return "HOUSEHOLD";
    default:
      return "GENERAL_SMB";
  }
}

export function isBenchmarkProfile(v: unknown): v is BenchmarkProfile {
  return typeof v === "string" && (BENCHMARK_PROFILES as readonly string[]).includes(v);
}

/** Which way is better: lower (a cost ratio), higher (a margin) or inside a band (too low can mean under-investing). */
type Better = "LOWER" | "HIGHER" | "BAND";

interface MetricDef {
  key: string;
  label: string;
  /** Matches an expense line (lower-cased "category label"). Absent = computed metric (net margin / savings rate). */
  match?: RegExp;
  /** Exclude lines that also match this (e.g. mortgage from the operating-expense ratio). */
  exclude?: RegExp;
  computed?: "NET_MARGIN" | "SAVINGS_RATE" | "ALL_EXPENSES";
  better: Better;
  /** Typical healthy range as shares of revenue. */
  lo: number;
  hi: number;
  /** LOWER/BAND: above this is "High" (between hi and highAt is "Watch"). */
  highAt?: number;
  /** HIGHER/BAND: below this is "Low" (between lowAt and lo is "Watch"). */
  lowAt?: number;
  /** What the metric means, for the info tip. */
  help: string;
}

const RX = {
  cogs: /cost of goods|cogs|inventory|wholesale|product cost|merchandise|materials|supplies|parts\b/,
  marketing: /marketing|advertis|\bads\b|google ads|facebook|meta ads|instagram|tiktok|linkedin ads|yelp|angi|seo|promotion|sponsor/,
  software: /software|saas|subscription|adobe|figma|notion|slack|google workspace|microsoft 365|shopify|jobber|servicetitan|housecall|hosting|domain|zoom|quickbooks|xero/,
  labor: /payroll|wage|salar|technician|labor|staff|gusto|adp|employee/,
  contractors: /contractor|freelance|subcontract|upwork|fiverr/,
  rent: /\brent\b|lease|office|cowork|wework|warehouse|facilit/,
  shipping: /shipping|fulfil|freight|postage|usps|\bups\b|fedex|dhl|shipstation|3pl/,
  fees: /merchant|processing|stripe|paypal|square fee|payment fee|transaction fee|marketplace fee|amazon fee|etsy fee/,
  vehicle: /vehicle|truck|fuel|diesel|gas station|auto|tire|fleet|mileage/,
  repairs: /repair|maintenance|handyman|plumb|hvac|landscap|lawn|pest/,
  mgmt: /property manag|management fee|pm fee|property manager/,
  mortgage: /mortgage|loan|principal|interest|debt service/,
  housing: /household rent|mortgage|\brent\b|hoa|property tax/,
  debt: /\bdebt\b|loan|credit card|card payment|minimum payment|car payment/,
  subs: /subscriptions?|netflix|spotify|hulu|disney|prime|youtube|apple\.com/,
  wants: /dining|entertainment|subscriptions?|restaurant|doordash|ubereats|grubhub|bar\b|cinema|concert|shopping/,
  savings: /investments?|401k|ira|roth|brokerage|savings transfer|invest/,
};

const PROFILES: Record<BenchmarkProfile, MetricDef[]> = {
  DIGITAL_AGENCY: [
    { key: "delivery", label: "Delivery labor (payroll + contractors)", match: new RegExp(`${RX.labor.source}|${RX.contractors.source}`), better: "LOWER", lo: 0.4, hi: 0.55, highAt: 0.65, help: "Staff and contractor cost to deliver client work. Agencies typically keep it at 40–55% of revenue." },
    { key: "software", label: "Software & SaaS", match: RX.software, better: "LOWER", lo: 0.02, hi: 0.08, highAt: 0.12, help: "Tooling stacks creep quietly; 2–8% of revenue is typical for a small agency." },
    { key: "marketing", label: "Marketing spend", match: RX.marketing, better: "BAND", lo: 0.03, hi: 0.1, highAt: 0.15, lowAt: 0.01, help: "Agencies grow mostly on referrals; 3–10% of revenue on marketing is common." },
    { key: "rent", label: "Rent & facilities", match: RX.rent, better: "LOWER", lo: 0, hi: 0.08, highAt: 0.12, help: "Office or coworking cost. Remote-first agencies often run well under 8%." },
    { key: "net", label: "Net profit margin", computed: "NET_MARGIN", better: "HIGHER", lo: 0.12, hi: 0.3, lowAt: 0.05, help: "What's left after every recurring cost. Healthy small agencies target 12–30%." },
  ],
  ECOMMERCE: [
    { key: "cogs", label: "COGS ratio", match: RX.cogs, better: "LOWER", lo: 0.25, hi: 0.5, highAt: 0.6, help: "Product cost as a share of sales. Most online retailers land at 25–50% (a 50–75% gross margin)." },
    { key: "marketing", label: "Marketing / ad spend", match: RX.marketing, better: "BAND", lo: 0.08, hi: 0.2, highAt: 0.28, lowAt: 0.03, help: "Paid acquisition is the growth engine; 8–20% of revenue is typical, above ~25% usually means rising CAC." },
    { key: "shipping", label: "Shipping & fulfillment", match: RX.shipping, better: "LOWER", lo: 0.05, hi: 0.15, highAt: 0.2, help: "Postage, packaging and 3PL fees. 5–15% of revenue is common." },
    { key: "fees", label: "Payment & marketplace fees", match: RX.fees, better: "LOWER", lo: 0.02, hi: 0.06, highAt: 0.1, help: "Card processing and marketplace commissions. 2–6% is typical; marketplaces can push it higher." },
    { key: "software", label: "Platform & software", match: RX.software, better: "LOWER", lo: 0.01, hi: 0.05, highAt: 0.08, help: "Storefront, apps and SaaS. 1–5% of revenue is typical." },
    { key: "net", label: "Net profit margin", computed: "NET_MARGIN", better: "HIGHER", lo: 0.08, hi: 0.2, lowAt: 0.03, help: "Online retail is a thin-margin business; 8–20% net is healthy." },
  ],
  FIELD_SERVICES: [
    { key: "materials", label: "Materials & parts (COGS)", match: RX.cogs, better: "LOWER", lo: 0.15, hi: 0.35, highAt: 0.42, help: "Job materials and parts. Most trades run 15–35% of revenue." },
    { key: "labor", label: "Field labor (payroll + subs)", match: new RegExp(`${RX.labor.source}|${RX.contractors.source}`), better: "LOWER", lo: 0.2, hi: 0.4, highAt: 0.48, help: "Technician wages and subcontractors. 20–40% of revenue is typical." },
    { key: "vehicle", label: "Vehicle & fuel", match: RX.vehicle, better: "LOWER", lo: 0.03, hi: 0.1, highAt: 0.14, help: "Fleet leases, fuel and upkeep. 3–10% of revenue is common." },
    { key: "marketing", label: "Marketing spend", match: RX.marketing, better: "BAND", lo: 0.03, hi: 0.08, highAt: 0.12, lowAt: 0.01, help: "Lead generation (ads, Angi, Yelp). 3–8% of revenue is typical." },
    { key: "net", label: "Net profit margin", computed: "NET_MARGIN", better: "HIGHER", lo: 0.1, hi: 0.25, lowAt: 0.05, help: "Well-run service businesses net 10–25%." },
  ],
  REAL_ESTATE: [
    { key: "opex", label: "Operating expense ratio", computed: "ALL_EXPENSES", exclude: RX.mortgage, better: "LOWER", lo: 0.3, hi: 0.45, highAt: 0.55, help: "Every recurring cost except mortgage / debt service, as a share of rent. 30–45% is the usual range (the \"50% rule\" is the ceiling)." },
    { key: "repairs", label: "Repairs & maintenance", match: RX.repairs, better: "BAND", lo: 0.05, hi: 0.1, highAt: 0.15, lowAt: 0.02, help: "Plan 5–10% of rent. Far below that often means deferred maintenance." },
    { key: "mgmt", label: "Property management", match: RX.mgmt, better: "LOWER", lo: 0.06, hi: 0.1, highAt: 0.12, help: "Full-service managers typically charge 6–10% of collected rent." },
    { key: "debt", label: "Debt service", match: RX.mortgage, better: "LOWER", lo: 0.2, hi: 0.5, highAt: 0.65, help: "Mortgage / loan payments as a share of rent. Above ~65% leaves little room for vacancies or repairs." },
    { key: "net", label: "Cash-flow margin", computed: "NET_MARGIN", better: "HIGHER", lo: 0.1, hi: 0.3, lowAt: 0.03, help: "Rent left after every recurring cost, including the mortgage. 10%+ is a healthy cushion." },
  ],
  GENERAL_SMB: [
    { key: "cogs", label: "COGS / direct costs", match: RX.cogs, better: "LOWER", lo: 0.2, hi: 0.5, highAt: 0.6, help: "Direct cost of what you sell. 20–50% of revenue is typical across small businesses." },
    { key: "labor", label: "Payroll & contractors", match: new RegExp(`${RX.labor.source}|${RX.contractors.source}`), better: "LOWER", lo: 0.15, hi: 0.35, highAt: 0.45, help: "People costs. 15–35% of revenue is a common range." },
    { key: "marketing", label: "Marketing spend", match: RX.marketing, better: "BAND", lo: 0.03, hi: 0.12, highAt: 0.18, lowAt: 0.01, help: "Most small businesses spend 3–12% of revenue on marketing." },
    { key: "software", label: "Software & SaaS", match: RX.software, better: "LOWER", lo: 0.01, hi: 0.05, highAt: 0.08, help: "1–5% of revenue is typical." },
    { key: "rent", label: "Rent & facilities", match: RX.rent, better: "LOWER", lo: 0.02, hi: 0.1, highAt: 0.15, help: "Occupancy cost. 2–10% of revenue for most small businesses." },
    { key: "net", label: "Net profit margin", computed: "NET_MARGIN", better: "HIGHER", lo: 0.07, hi: 0.2, lowAt: 0.03, help: "Small businesses typically net 7–20%." },
  ],
  HOUSEHOLD: [
    { key: "housing", label: "Housing", match: RX.housing, better: "LOWER", lo: 0.2, hi: 0.3, highAt: 0.4, help: "Rent or mortgage plus HOA / property tax. Keep it near 30% of take-home pay." },
    { key: "wants", label: "Wants (dining, entertainment, subs)", match: RX.wants, better: "LOWER", lo: 0.1, hi: 0.3, highAt: 0.38, help: "The \"30\" in 50/30/20: discretionary spending up to 30% of income." },
    { key: "debt", label: "Debt payments", match: RX.debt, better: "LOWER", lo: 0, hi: 0.15, highAt: 0.25, help: "Non-mortgage debt payments. Under 15% of income keeps them manageable." },
    { key: "subs", label: "Subscriptions", match: RX.subs, better: "LOWER", lo: 0, hi: 0.03, highAt: 0.05, help: "Streaming, apps and memberships. Under 3% of income." },
    { key: "savings", label: "Savings rate", computed: "SAVINGS_RATE", better: "HIGHER", lo: 0.2, hi: 0.4, lowAt: 0.1, help: "Investments plus unspent income. The \"20\" in 50/30/20." },
  ],
};

export type BenchmarkStatus = "HEALTHY" | "WATCH" | "HIGH" | "LOW" | "NO_DATA";

export const BENCHMARK_STATUS_LABEL: Record<BenchmarkStatus, string> = {
  HEALTHY: "Healthy",
  WATCH: "Watch",
  HIGH: "High",
  LOW: "Low",
  NO_DATA: "Not tracked",
};

export interface BenchmarkResult {
  key: string;
  label: string;
  /** Share of recurring revenue (0.18 = 18%). */
  value: number;
  /** Monthly dollars behind the share (absent for computed margins). */
  amount: number | null;
  lo: number;
  hi: number;
  status: BenchmarkStatus;
  better: Better;
  /** "Typical 15–25%". */
  typical: string;
  help: string;
  /** Monthly dollars above the top of the healthy range (cost ratios only), i.e. the gap to "Healthy". */
  excess: number;
}

const p0 = (n: number) => `${Math.round(n * 100)}%`;

function statusFor(d: MetricDef, v: number): BenchmarkStatus {
  if (d.better === "HIGHER") {
    if (v >= d.lo) return "HEALTHY";
    return d.lowAt != null && v < d.lowAt ? "LOW" : "WATCH";
  }
  if (d.better === "LOWER") {
    if (v <= d.hi) return "HEALTHY";
    return d.highAt != null && v > d.highAt ? "HIGH" : "WATCH";
  }
  // BAND
  if (v > d.hi) return d.highAt != null && v > d.highAt ? "HIGH" : "WATCH";
  if (v < d.lo) return d.lowAt != null && v < d.lowAt ? "LOW" : "WATCH";
  return "HEALTHY";
}

/** Compares recurring line items against the peer group. Empty when there's no recurring revenue to divide by. */
export function evaluateBenchmarks(profile: BenchmarkProfile, revenue: Pick<RevenueLine, "amount" | "oneTime">[], expenses: Pick<ExpenseLine, "label" | "category" | "amount" | "oneTime">[]): BenchmarkResult[] {
  const rev = sum(revenue.filter((r) => !r.oneTime), (r) => r.amount);
  if (!(rev > 0)) return [];
  const recurring = expenses.filter((e) => !e.oneTime);
  const hay = (e: (typeof recurring)[number]) => `${e.category} ${e.label}`.toLowerCase();
  const totalExp = sum(recurring, (e) => e.amount);

  return PROFILES[profile].map((d) => {
    let amount: number | null = null;
    let value: number;
    if (d.computed === "NET_MARGIN") value = (rev - totalExp) / rev;
    else if (d.computed === "SAVINGS_RATE") {
      const invested = sum(recurring.filter((e) => RX.savings.test(hay(e))), (e) => e.amount);
      value = (invested + Math.max(0, rev - totalExp)) / rev;
    } else {
      const lines = recurring.filter((e) => (d.computed === "ALL_EXPENSES" || (d.match && d.match.test(hay(e)))) && !(d.exclude && d.exclude.test(hay(e))));
      amount = round2(sum(lines, (e) => e.amount));
      value = amount / rev;
    }
    // A cost bucket with no lines at all is "not tracked" rather than a perfect 0%.
    const status: BenchmarkStatus = amount === 0 ? "NO_DATA" : statusFor(d, value);
    const excess = amount != null && d.better !== "HIGHER" && value > d.hi ? round2((value - d.hi) * rev) : 0;
    return {
      key: d.key,
      label: d.label,
      value,
      amount,
      lo: d.lo,
      hi: d.hi,
      status,
      better: d.better,
      typical: d.better === "HIGHER" ? `Typical ${p0(d.lo)}+` : d.lo === 0 ? `Typical under ${p0(d.hi)}` : `Typical ${p0(d.lo)}–${p0(d.hi)}`,
      help: d.help,
      excess,
    };
  });
}

/** Status → tone for chips: good (green), warn (amber), bad (red), muted. */
export function benchmarkTone(r: Pick<BenchmarkResult, "status" | "better">): "good" | "warn" | "bad" | "muted" {
  switch (r.status) {
    case "HEALTHY":
      return "good";
    case "WATCH":
      return "warn";
    case "HIGH":
      return "bad";
    case "LOW":
      // Too-low margin is bad; too-low marketing / maintenance spend is only a caution.
      return r.better === "HIGHER" ? "bad" : "warn";
    default:
      return "muted";
  }
}
