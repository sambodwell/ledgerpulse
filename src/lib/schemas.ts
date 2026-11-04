/**
 * LedgerPulse — financial domain constants, category templates, validators,
 * and macro (seasonality + inflation) projection rules.
 *
 * Everything in here is pure and deterministic so it can run on both the
 * server (API route) and the client (dashboard, guided form preview).
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

export const BUSINESS_TYPES = ["REAL_ESTATE", "FIELD_SERVICE", "AGENCY_FREELANCE", "OTHER_CUSTOM", "PERSONAL_FAMILY"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

/** Dashboard mode. PERSONAL_FAMILY is the only personal type; everything else is a business. */
export const WORKSPACE_MODES = ["BUSINESS", "PERSONAL"] as const;
export type WorkspaceMode = (typeof WORKSPACE_MODES)[number];

export const BUSINESS_ONLY_TYPES = BUSINESS_TYPES.filter((t) => t !== "PERSONAL_FAMILY") as Exclude<BusinessType, "PERSONAL_FAMILY">[];

export function modeOf(bt: BusinessType): WorkspaceMode {
  return bt === "PERSONAL_FAMILY" ? "PERSONAL" : "BUSINESS";
}

/** User-facing vocabulary that differs between business and personal mode. */
export const MODE_COPY: Record<WorkspaceMode, { revenue: string; revenueLines: string; expenses: string; net: string }> = {
  BUSINESS: { revenue: "Revenue", revenueLines: "Revenue stream", expenses: "Expenses", net: "Net / month" },
  PERSONAL: { revenue: "Income", revenueLines: "Income source", expenses: "Spending", net: "Left over / month" },
};

export const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface RevenueLine {
  label: string;
  amount: number; // monthly
  margin: number; // 0..1 gross margin
}

export interface ExpenseLine {
  label: string;
  amount: number; // monthly
  category: string;
  flag?: string;
}

export interface MacroProjection {
  month: string; // e.g. "Dec 2026"
  projectedRevenue: number;
  projectedExpenses: number;
}

export const AUDIT_FLAG_SOURCES = ["MODEL", "MISSING_CATEGORY", "BUDGET_RULE"] as const;
export type AuditFlagSource = (typeof AUDIT_FLAG_SOURCES)[number];

export interface AuditFlag {
  title: string;
  severity: Severity;
  message: string;
  potentialSavings: number; // monthly $
  /** Where the flag came from; absent on payloads produced before Phase 2. */
  source?: AuditFlagSource;
}

export interface WinnerInsight {
  topService: string;
  message: string;
}

export interface FinancialAnalysis {
  businessType: BusinessType;
  monthlyRevenue: number;
  itemizedRevenue: RevenueLine[];
  itemizedExpenses: ExpenseLine[];
  inflationRateAssumed: number;
  macroProjections: MacroProjection[];
  auditFlags: AuditFlag[];
  missingCategories: string[];
  winnerInsight: WinnerInsight;
}

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  REAL_ESTATE: "Real Estate / Rental Property",
  FIELD_SERVICE: "Field Service (HVAC, plumbing, landscaping…)",
  AGENCY_FREELANCE: "Agency / Freelance",
  OTHER_CUSTOM: "Other / Custom Business",
  PERSONAL_FAMILY: "Personal / Family Budget",
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && (BUSINESS_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Macro constants
// ---------------------------------------------------------------------------

/** Default annual inflation assumption applied to projections. */
export const DEFAULT_INFLATION_RATE = 0.037;
export const PROJECTION_MONTHS = 12;

// ---------------------------------------------------------------------------
// Category templates
// ---------------------------------------------------------------------------

export interface CategoryTemplate {
  /** Canonical category name, used as `ExpenseLine.category`. */
  category: string;
  /** Lower-case substrings that identify this category in free-text labels. */
  keywords: string[];
  /** If true, its absence is surfaced as a missing-category warning. */
  essential: boolean;
  /** Why this line matters — shown in the warning. */
  rationale?: string;
}

export interface BusinessTemplate {
  revenue: string[];
  expenses: CategoryTemplate[];
}

export const CATEGORY_TEMPLATES: Record<BusinessType, BusinessTemplate> = {
  REAL_ESTATE: {
    revenue: ["Rental Income", "Late Fees", "Parking / Storage", "Laundry / Utilities Reimbursement", "Pet Rent"],
    expenses: [
      { category: "Mortgage Interest", keywords: ["mortgage", "loan interest", "principal"], essential: true, rationale: "Usually the largest line and a deductible interest expense." },
      { category: "Property Taxes", keywords: ["property tax", "county tax", "real estate tax", "tax assessor"], essential: true, rationale: "Typically 1–2.5% of property value per year; easy to under-budget when escrowed." },
      { category: "Insurance", keywords: ["insurance", "landlord policy", "hazard", "liability"], essential: true, rationale: "Landlord/hazard coverage is required by most lenders and is deductible." },
      { category: "Repairs & Maintenance", keywords: ["repair", "maintenance", "plumb", "hvac", "handyman"], essential: true, rationale: "Plan ~1% of property value per year or 5–10% of rent." },
      {
        category: "Property Maintenance & Landscaping",
        keywords: ["landscap", "lawn", "yard", "mowing", "tree trim", "tree service", "gardening", "snow removal", "gutter", "groundskeep", "pest control"],
        essential: false,
      },
      { category: "Property Management", keywords: ["management", "pm fee", "property manager"], essential: false },
      { category: "Utilities", keywords: ["utilit", "water", "electric", "gas", "trash", "sewer"], essential: false },
      { category: "HOA Fees", keywords: ["hoa", "association", "condo fee"], essential: false },
      { category: "Capital Reserves", keywords: ["reserve", "capex", "capital"], essential: true, rationale: "Roofs, HVAC and appliances fail on a schedule — reserve 5–10% of rent." },
      { category: "Vacancy Allowance", keywords: ["vacancy"], essential: false },
    ],
  },
  FIELD_SERVICE: {
    revenue: ["Service Calls", "Installations", "Maintenance Contracts", "Emergency / After-hours", "Parts Markup"],
    expenses: [
      { category: "Fuel", keywords: ["fuel", "gas station", "diesel", "shell", "chevron", "exxon", "bp "], essential: true, rationale: "Fuel tracks route density and is a deductible vehicle cost." },
      { category: "Supplies & Materials", keywords: ["suppl", "material", "parts", "home depot", "lowe", "ferguson"], essential: true, rationale: "Materials drive job margin; missing lines usually mean untracked job costs." },
      { category: "Vehicle Costs", keywords: ["vehicle", "truck", "auto", "lease", "repair shop", "tire"], essential: true, rationale: "Vehicle lease/maintenance is deductible and often under-reported." },
      { category: "Payroll / Subcontractors", keywords: ["payroll", "wage", "subcontract", "technician", "labor"], essential: false },
      { category: "Insurance", keywords: ["insurance", "liability", "workers comp", "bond"], essential: true, rationale: "General liability and workers' comp are typically required to operate." },
      { category: "Tools & Equipment", keywords: ["tool", "equipment", "rental"], essential: false },
      { category: "Software & Dispatch", keywords: ["software", "jobber", "servicetitan", "housecall", "subscription"], essential: false },
      { category: "Licensing & Permits", keywords: ["license", "permit", "certification"], essential: false },
      { category: "Marketing", keywords: ["marketing", "ads", "google ads", "yelp", "angi"], essential: false },
    ],
  },
  AGENCY_FREELANCE: {
    revenue: ["Retainers", "Project Fees", "Hourly Consulting", "Affiliate / Referral", "Productized Services"],
    expenses: [
      { category: "Software & SaaS", keywords: ["software", "saas", "subscription", "adobe", "figma", "notion", "slack", "google workspace"], essential: true, rationale: "Subscriptions are deductible and the most common source of silent spend creep." },
      { category: "Contractors", keywords: ["contractor", "freelance", "upwork", "fiverr", "subcontract"], essential: false },
      { category: "Payroll", keywords: ["payroll", "salary", "wage", "gusto"], essential: false },
      { category: "Self-Employment Tax Reserve", keywords: ["estimated tax", "quarterly tax", "irs", "tax reserve", "self-employment"], essential: true, rationale: "Set aside ~25–30% of profit for quarterly estimated taxes to avoid penalties." },
      { category: "Health Insurance", keywords: ["health", "medical", "dental"], essential: true, rationale: "Self-employed health premiums are often deductible above the line." },
      { category: "Home Office / Rent", keywords: ["rent", "office", "cowork", "wework"], essential: false },
      { category: "Professional Services", keywords: ["accountant", "cpa", "legal", "attorney", "bookkeep"], essential: false },
      { category: "Marketing", keywords: ["marketing", "ads", "linkedin", "website", "hosting"], essential: false },
      { category: "Equipment", keywords: ["laptop", "computer", "equipment", "monitor"], essential: false },
    ],
  },
  // "Other / Custom": owners define their own lines; nothing is essential, so no missing-category warnings.
  OTHER_CUSTOM: {
    revenue: ["Sales", "Services", "Other Income"],
    expenses: [
      { category: "Cost of Goods Sold", keywords: ["cogs", "inventory", "wholesale", "materials"], essential: false },
      { category: "Payroll", keywords: ["payroll", "salary", "wage", "gusto"], essential: false },
      { category: "Rent & Facilities", keywords: ["rent", "lease", "office", "warehouse"], essential: false },
      { category: "Software & SaaS", keywords: ["software", "saas", "subscription"], essential: false },
      { category: "Insurance", keywords: ["insurance", "liability"], essential: false },
      { category: "Marketing", keywords: ["marketing", "ads", "advertising"], essential: false },
      { category: "Taxes & Fees", keywords: ["tax", "fee", "license", "permit"], essential: false },
      { category: "Other", keywords: [], essential: false },
    ],
  },
  PERSONAL_FAMILY: {
    revenue: ["Salary / Wages", "Partner Income", "Side Income", "Benefits / Support", "Investment Income"],
    expenses: [
      { category: "Household Rent/Mortgage", keywords: ["rent", "mortgage", "landlord", "hoa", "property tax"], essential: true, rationale: "Housing is usually the largest line; keep it near 30% of take-home pay." },
      { category: "Groceries", keywords: ["grocer", "supermarket", "costco", "walmart", "kroger", "aldi", "trader joe", "whole foods", "safeway"], essential: true, rationale: "Food at home is a core need and a common place to find savings." },
      { category: "Utilities", keywords: ["utilit", "electric", "water", "gas bill", "internet", "phone", "wireless", "comcast", "verizon", "at&t"], essential: true, rationale: "Power, water, internet and phone are fixed needs that are easy to under-budget." },
      { category: "Subscriptions", keywords: ["netflix", "spotify", "hulu", "disney", "subscription", "prime", "apple.com", "youtube", "gym"], essential: false },
      { category: "Investments", keywords: ["401k", "ira", "roth", "brokerage", "vanguard", "fidelity", "schwab", "savings transfer", "invest"], essential: true, rationale: "Paying yourself first (aim for 15–20% of income) is how budgets build wealth." },
      { category: "Debt", keywords: ["loan", "credit card", "card payment", "student loan", "car payment", "auto loan", "minimum payment"], essential: false },
      { category: "Insurance", keywords: ["insurance", "geico", "state farm", "progressive", "premium"], essential: false },
      { category: "Transportation", keywords: ["fuel", "gas station", "uber", "lyft", "transit", "parking", "toll"], essential: false },
      { category: "Childcare & Education", keywords: ["daycare", "childcare", "tuition", "school"], essential: false },
      { category: "Dining & Entertainment", keywords: ["restaurant", "doordash", "ubereats", "grubhub", "bar", "cinema", "concert"], essential: false },
    ],
  },
};

/**
 * Example sub-line items per category, shown as the line-item placeholder in the
 * guided form so users describe the specific expense instead of retyping the category.
 */
export const CATEGORY_LINE_HINTS: Record<string, string> = {
  "Mortgage Interest": "e.g. Wells Fargo loan – Unit A",
  "Property Taxes": "e.g. County tax installment",
  Insurance: "e.g. Liability policy premium",
  "Repairs & Maintenance": "e.g. Plumber call, HVAC service",
  "Property Maintenance & Landscaping": "e.g. Lawn care, yard work, tree trimming",
  "Property Management": "e.g. PM fee (8% of rent)",
  Utilities: "e.g. Electric, water, internet",
  "HOA Fees": "e.g. Monthly association dues",
  "Capital Reserves": "e.g. Roof / appliance reserve",
  "Vacancy Allowance": "e.g. 5% of scheduled rent",
  Fuel: "e.g. Truck diesel, fleet fuel cards",
  "Supplies & Materials": "e.g. Copper pipe, fittings, filters",
  "Vehicle Costs": "e.g. Van lease, tires, oil changes",
  "Payroll / Subcontractors": "e.g. Lead technician wages",
  "Tools & Equipment": "e.g. Drain camera rental",
  "Software & Dispatch": "e.g. Jobber subscription",
  "Licensing & Permits": "e.g. Contractor license renewal",
  Marketing: "e.g. Google Ads, yard signs",
  "Software & SaaS": "e.g. Adobe, Figma, Slack",
  Contractors: "e.g. Freelance developer",
  Payroll: "e.g. Staff salaries via Gusto",
  "Self-Employment Tax Reserve": "e.g. Quarterly estimated tax set-aside",
  "Health Insurance": "e.g. Marketplace health premium",
  "Home Office / Rent": "e.g. Coworking membership",
  "Professional Services": "e.g. CPA, bookkeeper",
  Equipment: "e.g. Laptop, monitor",
  "Cost of Goods Sold": "e.g. Wholesale inventory",
  "Rent & Facilities": "e.g. Warehouse lease",
  "Taxes & Fees": "e.g. Business license, bank fees",
  "Household Rent/Mortgage": "e.g. Apartment rent, home loan",
  Groceries: "e.g. Weekly grocery runs",
  Subscriptions: "e.g. Netflix, Spotify, gym",
  Investments: "e.g. 401(k) deduction, Roth IRA transfer",
  Debt: "e.g. Credit card, student loan payment",
  Transportation: "e.g. Car payment, gas, transit pass",
  "Childcare & Education": "e.g. Daycare, tuition",
  "Dining & Entertainment": "e.g. Restaurants, concerts",
  Other: "Describe the expense",
};

/** Extra guidance for categories whose scope is easy to misread. Keyed by category. */
export const CATEGORY_HELP: Partial<Record<string, string>> = {
  Investments: "Includes routine payroll deductions or discretionary transfers toward wealth building (e.g., 401(k), IRA, or brokerage allocations).",
};

// ---------------------------------------------------------------------------
// Personal budget rules (50/30/20 + housing / debt / subscription guardrails)
// ---------------------------------------------------------------------------

export type BudgetBucket = "NEEDS" | "WANTS" | "SAVINGS";

/** Which 50/30/20 bucket each personal category falls in. Unknown categories count as WANTS. */
export const PERSONAL_BUCKETS: Record<string, BudgetBucket> = {
  "Household Rent/Mortgage": "NEEDS",
  Groceries: "NEEDS",
  Utilities: "NEEDS",
  Insurance: "NEEDS",
  Transportation: "NEEDS",
  "Childcare & Education": "NEEDS",
  Debt: "NEEDS", // minimum payments are obligations; extra payments are savings, but we can't tell them apart
  Subscriptions: "WANTS",
  "Dining & Entertainment": "WANTS",
  Investments: "SAVINGS",
};

export const PERSONAL_BUDGET_RULES = {
  needsMaxShare: 0.5,
  wantsMaxShare: 0.3,
  savingsMinShare: 0.2,
  housingMaxShare: 0.3,
  debtMaxShare: 0.15,
  subscriptionsMaxShare: 0.03,
} as const;

/** Deterministic budget-health flags for PERSONAL_FAMILY analyses. */
export function evaluatePersonalBudget(monthlyIncome: number, expenses: Pick<ExpenseLine, "category" | "amount">[]): AuditFlag[] {
  if (monthlyIncome <= 0) return [];
  const r = PERSONAL_BUDGET_RULES;
  const byCat = (c: string) => sum(expenses.filter((e) => e.category === c), (e) => e.amount);
  const bucket = (b: BudgetBucket) => sum(expenses.filter((e) => (PERSONAL_BUCKETS[e.category] ?? "WANTS") === b), (e) => e.amount);
  const share = (n: number) => n / monthlyIncome;
  const p = (n: number) => `${Math.round(n * 100)}%`;
  const flags: AuditFlag[] = [];

  const housing = byCat("Household Rent/Mortgage");
  if (share(housing) > r.housingMaxShare) {
    flags.push({
      title: "Housing above 30% of income",
      severity: share(housing) > 0.4 ? "HIGH" : "MEDIUM",
      message: `Housing takes ${p(share(housing))} of income. Above ~30%, the rest of the budget gets squeezed; refinancing, a roommate, or renegotiating at renewal are the usual levers.`,
      potentialSavings: 0,
      source: "BUDGET_RULE",
    });
  }

  const debt = byCat("Debt");
  if (share(debt) > r.debtMaxShare) {
    flags.push({
      title: "High debt payments",
      severity: share(debt) > 0.25 ? "HIGH" : "MEDIUM",
      message: `Debt payments are ${p(share(debt))} of income. Target the highest-APR balance first and check whether a lower-rate consolidation is available.`,
      potentialSavings: round2(debt * 0.1),
      source: "BUDGET_RULE",
    });
  }

  const subs = byCat("Subscriptions");
  if (share(subs) > r.subscriptionsMaxShare) {
    flags.push({
      title: "Subscription creep",
      severity: "MEDIUM",
      message: `Subscriptions cost ${p(share(subs))} of income. Cancel anything unused in the last 30 days and rotate streaming services instead of stacking them.`,
      potentialSavings: round2(subs - monthlyIncome * r.subscriptionsMaxShare),
      source: "BUDGET_RULE",
    });
  }

  const savings = bucket("SAVINGS");
  const leftover = monthlyIncome - sum(expenses, (e) => e.amount);
  if (share(savings + Math.max(0, leftover)) < r.savingsMinShare) {
    flags.push({
      title: "Saving less than 20%",
      severity: leftover < 0 ? "HIGH" : "MEDIUM",
      message:
        leftover < 0
          ? `Spending exceeds income by ${Math.round(-leftover).toLocaleString("en-US")} a month. Cover the gap before adding savings goals.`
          : `Savings plus unspent income is ${p(share(savings + leftover))} of income. Automate a transfer on payday to reach the 20% guideline.`,
      potentialSavings: 0,
      source: "BUDGET_RULE",
    });
  }

  const wants = bucket("WANTS");
  if (share(wants) > r.wantsMaxShare) {
    flags.push({
      title: "Discretionary spending above 30%",
      severity: "LOW",
      message: `Wants (dining, entertainment, subscriptions) are ${p(share(wants))} of income versus the 30% guideline.`,
      potentialSavings: round2(wants - monthlyIncome * r.wantsMaxShare),
      source: "BUDGET_RULE",
    });
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Macro multiplier rules
// ---------------------------------------------------------------------------

/**
 * Monthly seasonality multipliers, January → December. Each row averages 1.0 so
 * seasonality reshapes cash flow across the year without changing the annual total.
 */
export const SEASONALITY: Record<BusinessType, { revenue: number[]; expenses: number[] }> = {
  // Rents are stable; vacancy spikes in winter turnover; maintenance peaks in spring/fall.
  REAL_ESTATE: {
    revenue: [0.97, 0.97, 0.99, 1.0, 1.01, 1.02, 1.03, 1.03, 1.01, 1.0, 0.99, 0.98],
    expenses: [1.08, 0.95, 0.98, 1.06, 1.0, 0.94, 0.95, 0.96, 1.0, 1.06, 0.98, 1.04],
  },
  // HVAC/landscaping/plumbing demand peaks in summer, dips in deep winter.
  FIELD_SERVICE: {
    revenue: [0.78, 0.8, 0.92, 1.03, 1.12, 1.22, 1.26, 1.2, 1.05, 0.96, 0.86, 0.8],
    expenses: [0.88, 0.88, 0.95, 1.02, 1.07, 1.12, 1.14, 1.1, 1.02, 0.97, 0.93, 0.92],
  },
  // Agencies: Q4 budget flush, Q1 slow start, summer lull.
  AGENCY_FREELANCE: {
    revenue: [0.88, 0.93, 1.02, 1.03, 1.04, 0.98, 0.9, 0.9, 1.04, 1.08, 1.1, 1.1],
    expenses: [1.02, 0.98, 1.0, 1.0, 1.0, 0.99, 0.98, 0.98, 1.0, 1.01, 1.02, 1.02],
  },
  // Unknown business: no seasonal assumption.
  OTHER_CUSTOM: {
    revenue: Array(12).fill(1),
    expenses: Array(12).fill(1),
  },
  // Households: steady pay; winter heating, summer cooling, back-to-school and holiday spending.
  PERSONAL_FAMILY: {
    revenue: Array(12).fill(1),
    expenses: [1.02, 0.97, 0.97, 0.96, 0.97, 1.0, 1.02, 1.04, 0.99, 0.97, 1.0, 1.09],
  },
};

/**
 * Share of inflation a business can pass through to customers via pricing.
 * Expenses always absorb 100% of inflation.
 */
export const INFLATION_PASS_THROUGH: Record<BusinessType, number> = {
  REAL_ESTATE: 0.5, // leases reprice only at renewal
  FIELD_SERVICE: 0.8, // job pricing adjusts quickly
  AGENCY_FREELANCE: 0.6, // retainers lag
  OTHER_CUSTOM: 0.6,
  PERSONAL_FAMILY: 0.7, // wage growth trails inflation
};

const MONTH_FMT = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Builds a 12-month projection starting next month.
 * month m (1-based) compounds inflation as (1 + rate)^(m/12).
 */
export function buildMacroProjections(params: {
  businessType: BusinessType;
  monthlyRevenue: number;
  monthlyExpenses: number;
  inflationRate?: number;
  startDate?: Date;
  months?: number;
}): MacroProjection[] {
  const {
    businessType,
    monthlyRevenue,
    monthlyExpenses,
    inflationRate = DEFAULT_INFLATION_RATE,
    startDate = new Date(),
    months = PROJECTION_MONTHS,
  } = params;
  return projectionFactors({ businessType, inflationRate, startDate, months }).map((f) => ({
    month: f.month,
    projectedRevenue: round2(monthlyRevenue * f.revenue),
    projectedExpenses: round2(monthlyExpenses * f.expenses),
  }));
}

/** Per-month seasonality × inflation multipliers shared by baseline and scenario projections. */
export function projectionFactors(params: {
  businessType: BusinessType;
  inflationRate?: number;
  startDate?: Date;
  months?: number;
}): { month: string; revenue: number; expenses: number }[] {
  const { businessType, inflationRate = DEFAULT_INFLATION_RATE, startDate = new Date(), months = PROJECTION_MONTHS } = params;
  const season = SEASONALITY[businessType];
  const passThrough = INFLATION_PASS_THROUGH[businessType];
  const out: { month: string; revenue: number; expenses: number }[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1));
    const monthIdx = d.getUTCMonth();
    out.push({
      month: MONTH_FMT.format(d),
      revenue: season.revenue[monthIdx] * Math.pow(1 + inflationRate * passThrough, i / 12),
      expenses: season.expenses[monthIdx] * Math.pow(1 + inflationRate, i / 12),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scenario forecasting
// ---------------------------------------------------------------------------

/**
 * One structured change parsed from a natural-language "what if".
 * `startMonth` is 1-based into the 12-month projection (1 = next month).
 * `match` is matched case-insensitively against line category and label; null = all lines.
 */
export type ScenarioAdjustment =
  | { type: "REVENUE_PCT" | "EXPENSE_PCT"; match: string | null; pct: number; startMonth: number; description: string }
  | { type: "REVENUE_ADD" | "EXPENSE_ADD"; label: string; amount: number; startMonth: number; description: string };

export interface ScenarioPlan {
  prompt: string;
  adjustments: ScenarioAdjustment[];
  assumptions: string[];
  explanation: string;
}

export interface ScenarioPoint {
  month: string;
  baselineNet: number;
  adjustedNet: number;
  baselineCumulative: number;
  adjustedCumulative: number;
  adjustedRevenue: number;
  adjustedExpenses: number;
}

export interface ScenarioResult {
  points: ScenarioPoint[];
  baselineAnnualNet: number;
  adjustedAnnualNet: number;
  delta: number;
  /** Adjustments whose `match` hit no line items, so they changed nothing. */
  unmatched: string[];
}

export interface ScenarioBaseline {
  businessType: BusinessType;
  itemizedRevenue: Pick<RevenueLine, "label" | "amount">[];
  itemizedExpenses: Pick<ExpenseLine, "label" | "amount" | "category">[];
  inflationRateAssumed: number;
}

const matches = (needle: string | null, ...hay: string[]) => {
  if (!needle) return true;
  const n = needle.toLowerCase();
  return hay.some((h) => {
    const s = h.trim().toLowerCase();
    return s.length > 0 && (s.includes(n) || n.includes(s));
  });
};

/** Applies scenario adjustments on top of the baseline line items and projects 12 months. */
export function applyScenario(base: ScenarioBaseline, adjustments: ScenarioAdjustment[], startDate = new Date()): ScenarioResult {
  const factors = projectionFactors({ businessType: base.businessType, inflationRate: base.inflationRateAssumed, startDate });
  const baseRev = sum(base.itemizedRevenue, (r) => r.amount);
  const baseExp = sum(base.itemizedExpenses, (e) => e.amount);

  const unmatched = adjustments
    .filter((a) => (a.type === "REVENUE_PCT" || a.type === "EXPENSE_PCT") && a.match)
    .filter((a) => {
      const m = (a as Extract<ScenarioAdjustment, { match: string | null }>).match;
      return a.type === "REVENUE_PCT"
        ? !base.itemizedRevenue.some((r) => matches(m, r.label))
        : !base.itemizedExpenses.some((e) => matches(m, e.category, e.label));
    })
    .map((a) => a.description);

  const points: ScenarioPoint[] = [];
  factors.forEach((f, idx) => {
    const m = idx + 1;
    const active = adjustments.filter((a) => m >= clampMonth(a.startMonth));
    let rev = 0;
    for (const r of base.itemizedRevenue) {
      const mult = active.filter((a) => a.type === "REVENUE_PCT" && matches(a.match, r.label)).reduce((acc, a) => acc * (1 + (a as { pct: number }).pct), 1);
      rev += r.amount * mult;
    }
    let exp = 0;
    for (const e of base.itemizedExpenses) {
      const mult = active.filter((a) => a.type === "EXPENSE_PCT" && matches(a.match, e.category, e.label)).reduce((acc, a) => acc * (1 + (a as { pct: number }).pct), 1);
      exp += e.amount * mult;
    }
    rev += sum(active.filter((a) => a.type === "REVENUE_ADD"), (a) => (a as { amount: number }).amount);
    exp += sum(active.filter((a) => a.type === "EXPENSE_ADD"), (a) => (a as { amount: number }).amount);

    const adjustedRevenue = round2(rev * f.revenue);
    const adjustedExpenses = round2(exp * f.expenses);
    const baselineNet = round2(baseRev * f.revenue - baseExp * f.expenses);
    const adjustedNet = round2(adjustedRevenue - adjustedExpenses);
    const prev = points.at(-1);
    points.push({
      month: f.month,
      baselineNet,
      adjustedNet,
      adjustedRevenue,
      adjustedExpenses,
      baselineCumulative: round2((prev?.baselineCumulative ?? 0) + baselineNet),
      adjustedCumulative: round2((prev?.adjustedCumulative ?? 0) + adjustedNet),
    });
  });

  const baselineAnnualNet = points.at(-1)?.baselineCumulative ?? 0;
  const adjustedAnnualNet = points.at(-1)?.adjustedCumulative ?? 0;
  return { points, baselineAnnualNet, adjustedAnnualNet, delta: round2(adjustedAnnualNet - baselineAnnualNet), unmatched };
}

function clampMonth(m: number) {
  return Number.isFinite(m) ? Math.min(PROJECTION_MONTHS, Math.max(1, Math.round(m))) : 1;
}

export function isScenarioAdjustment(v: unknown): v is ScenarioAdjustment {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  if (typeof a.startMonth !== "number" || typeof a.description !== "string") return false;
  if (a.type === "REVENUE_PCT" || a.type === "EXPENSE_PCT") return typeof a.pct === "number" && (a.match === null || typeof a.match === "string");
  if (a.type === "REVENUE_ADD" || a.type === "EXPENSE_ADD") return typeof a.amount === "number" && typeof a.label === "string";
  return false;
}

// ---------------------------------------------------------------------------
// Accounts, workspaces & paywall
// ---------------------------------------------------------------------------

export const PLAN_CATEGORIES = ["PERSONAL_FAMILY", "SMALL_BUSINESS"] as const;
export type PlanCategory = (typeof PLAN_CATEGORIES)[number];
export const PLAN_CATEGORY_LABELS: Record<PlanCategory, string> = {
  PERSONAL_FAMILY: "Personal / Family",
  SMALL_BUSINESS: "Small Business",
};

export type SubscriptionTier = "free" | "pro";

export interface UserProfile {
  id: string;
  email: string | null;
  planCategory: PlanCategory;
  tier: SubscriptionTier;
  subscriptionStatus: string | null;
  reportUnlocks: number;
  hasStripeCustomer: boolean;
  defaultWorkspaceId: string | null;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  mode: WorkspaceMode;
  businessType: BusinessType;
  createdAt: string;
}

export interface SavedScenario {
  id: string;
  workspaceId: string;
  prompt: string;
  adjustments: ScenarioAdjustment[];
  summary: { baselineAnnualNet: number; adjustedAnnualNet: number; delta: number; explanation: string };
  createdAt: string;
}

export const PRICING = {
  reportUnlockUsd: 29,
  proMonthlyUsd: 39,
} as const;

/** Marketing copy for pricing cards / paywalls. Keep in sync with server caps (AI_QUERY_CAP). */
export const PLANS = {
  report: {
    name: "Single Audit",
    price: `$${PRICING.reportUnlockUsd} one-time`,
    badge: "Recommended for Households & Individuals",
    features: ["One-Time Full Executive Report", "Cryptographically Sealed Audit PDF", "12-Month Solvency Baseline", "3 AI Scenario Queries"],
  },
  pro: {
    name: "Pro",
    price: `$${PRICING.proMonthlyUsd}/mo`,
    badge: "Recommended for Businesses & Serious Operators",
    features: [
      "Unlimited Guided Audits",
      "Dual-Workspace Sync (Personal + Business)",
      "Interactive Macro-Scenario Modeler (sliders & custom graphs)",
      "50 AI Assistant Queries/mo",
      "CSV/Excel Export",
      "Priority Processing",
    ],
  },
} as const;

/**
 * What the API tells the client about access. In "teaser" mode the analysis
 * payload has been redacted server-side: only the top HIGH flag, no projections,
 * no per-line flags. `sealed` is an encrypted copy of the full analysis that
 * only the server can open, so an unlock doesn't require re-running the model.
 */
export interface AnalysisAccess {
  level: "full" | "teaser";
  tier: SubscriptionTier;
  signedIn: boolean;
  totalFlagCount: number;
  lockedFlagCount: number;
  reportUnlocks: number;
  sealed: string | null;
}

export interface AnalysisResponse {
  analysis: FinancialAnalysis;
  access: AnalysisAccess;
}

export function isAnalysisResponse(value: unknown): value is AnalysisResponse {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const a = v.access as Record<string, unknown> | undefined;
  return isFinancialAnalysis(v.analysis) && !!a && (a.level === "full" || a.level === "teaser") && typeof a.lockedFlagCount === "number";
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

export interface MissingCategoryWarning {
  category: string;
  severity: Severity;
  message: string;
}

/**
 * Checks whether essential expense lines for the business type are present.
 * Matches on the line's category first, then on keywords in its label.
 */
export function detectMissingCategories(data: {
  businessType: BusinessType;
  itemizedExpenses: Pick<ExpenseLine, "label" | "category">[];
}): MissingCategoryWarning[] {
  const template = CATEGORY_TEMPLATES[data.businessType];
  const haystack = data.itemizedExpenses.map((e) => `${e.category} ${e.label}`.toLowerCase());

  return template.expenses
    .filter((t) => t.essential)
    .filter((t) => {
      const cat = t.category.toLowerCase();
      return !haystack.some((h) => h.includes(cat) || t.keywords.some((k) => h.includes(k)));
    })
    .map((t) => ({
      category: t.category,
      severity: "MEDIUM" as const,
      message: `No "${t.category}" line found. ${t.rationale ?? ""} Add it so your runway isn't overstated.`.trim(),
    }));
}

/** Runtime check for an analysis payload (e.g. data coming back from the API). */
export function isFinancialAnalysis(value: unknown): value is FinancialAnalysis {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    isBusinessType(v.businessType) &&
    typeof v.monthlyRevenue === "number" &&
    Array.isArray(v.itemizedRevenue) &&
    Array.isArray(v.itemizedExpenses) &&
    typeof v.inflationRateAssumed === "number" &&
    Array.isArray(v.macroProjections) &&
    Array.isArray(v.auditFlags) &&
    Array.isArray(v.missingCategories) &&
    !!v.winnerInsight &&
    typeof v.winnerInsight === "object"
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function sum<T>(items: T[], pick: (t: T) => number): number {
  return items.reduce((acc, t) => acc + (Number.isFinite(pick(t)) ? pick(t) : 0), 0);
}
