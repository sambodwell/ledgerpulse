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

export const BUSINESS_TYPES = ["REAL_ESTATE", "FIELD_SERVICE", "AGENCY_FREELANCE"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

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

export interface AuditFlag {
  title: string;
  severity: Severity;
  message: string;
  potentialSavings: number; // monthly $
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
};

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
};

/**
 * Share of inflation a business can pass through to customers via pricing.
 * Expenses always absorb 100% of inflation.
 */
export const INFLATION_PASS_THROUGH: Record<BusinessType, number> = {
  REAL_ESTATE: 0.5, // leases reprice only at renewal
  FIELD_SERVICE: 0.8, // job pricing adjusts quickly
  AGENCY_FREELANCE: 0.6, // retainers lag
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
  const season = SEASONALITY[businessType];
  const passThrough = INFLATION_PASS_THROUGH[businessType];

  const out: MacroProjection[] = [];
  for (let i = 1; i <= months; i++) {
    const d = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + i, 1));
    const monthIdx = d.getUTCMonth();
    const expenseInflation = Math.pow(1 + inflationRate, i / 12);
    const revenueInflation = Math.pow(1 + inflationRate * passThrough, i / 12);
    out.push({
      month: MONTH_FMT.format(d),
      projectedRevenue: round2(monthlyRevenue * season.revenue[monthIdx] * revenueInflation),
      projectedExpenses: round2(monthlyExpenses * season.expenses[monthIdx] * expenseInflation),
    });
  }
  return out;
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
