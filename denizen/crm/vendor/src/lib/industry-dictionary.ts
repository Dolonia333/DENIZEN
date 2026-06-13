/** Centralized industry vocabulary — single source for useCRMTranslation() */

export const CRM_USER_ROLES = ["Manager", "Team Member"] as const;
export type CRMUserRole = (typeof CRM_USER_ROLES)[number];

export const ACTIVE_INDUSTRIES = ["default", "healthcare", "nonprofit", "financial"] as const;
export type ActiveIndustry = (typeof ACTIVE_INDUSTRIES)[number];

export type IndustryDictionaryKey =
  | "contacts"
  | "contact"
  | "deals"
  | "deal"
  | "hub"
  | "pipeline"
  | "pipelineValue"
  | "accounts"
  | "customers";

export const DEFAULT_INDUSTRY_TERMS: Record<IndustryDictionaryKey, string> = {
  contacts: "Contacts",
  contact: "Contact",
  deals: "Deals",
  deal: "Deal",
  hub: "Sales Hub",
  pipeline: "Pipeline",
  pipelineValue: "Pipeline Value",
  accounts: "Accounts",
  customers: "Customers",
};

export const INDUSTRY_DICTIONARY: Record<
  ActiveIndustry,
  Partial<Record<IndustryDictionaryKey, string>>
> = {
  default: DEFAULT_INDUSTRY_TERMS,
  healthcare: {
    contacts: "Patients",
    contact: "Patient",
    deals: "Care Plans",
    deal: "Care Plan",
    hub: "Medical Hub",
    pipeline: "Treatments & Care Plans",
    pipelineValue: "Care Plan Value",
    accounts: "Medical Facilities",
    customers: "Patients",
  },
  nonprofit: {
    contacts: "Donors",
    contact: "Donor",
    deals: "Grants",
    deal: "Grant",
    hub: "Fundraising Hub",
    pipeline: "Donations & Grants",
    pipelineValue: "Funding Targets",
    accounts: "Programs",
    customers: "Donors",
  },
  financial: {
    contacts: "Clients",
    contact: "Client",
    deals: "Portfolios",
    deal: "Portfolio",
    hub: "Wealth Hub",
    pipeline: "Portfolio Pipeline",
    pipelineValue: "Assets Under Management",
    accounts: "Households",
    customers: "Clients",
  },
};

const EDITION_BY_INDUSTRY: Record<ActiveIndustry, string> = {
  default: "Sales Cloud Edition",
  healthcare: "Health Cloud Edition",
  nonprofit: "Nonprofit Cloud Edition",
  financial: "Financial Services Cloud Edition",
};

export function isCRMUserRole(value: unknown): value is CRMUserRole {
  return typeof value === "string" && (CRM_USER_ROLES as readonly string[]).includes(value);
}

export function isActiveIndustry(value: unknown): value is ActiveIndustry {
  return typeof value === "string" && (ACTIVE_INDUSTRIES as readonly string[]).includes(value);
}

export function industryConfigIdToActiveIndustry(configId: string): ActiveIndustry {
  if (configId === "healthcare") return "healthcare";
  if (configId === "nonprofit") return "nonprofit";
  if (configId === "financial-services") return "financial";
  return "default";
}

export function translateTerm(industry: ActiveIndustry, key: IndustryDictionaryKey): string {
  const industryTerms = INDUSTRY_DICTIONARY[industry];
  const value = industryTerms?.[key];
  if (typeof value === "string" && value.length > 0) return value;
  return DEFAULT_INDUSTRY_TERMS[key];
}

export function getEditionLabel(industry: ActiveIndustry): string {
  return EDITION_BY_INDUSTRY[industry] ?? EDITION_BY_INDUSTRY.default;
}

export const CRM_PREFS_STORAGE_KEYS = {
  role: "meridian_currentUserRole",
  industry: "meridian_activeIndustry",
} as const;
