import { useCallback, useMemo } from "react";
import { useIndustryConfig } from "@/lib/crm-industry-bridge";
import {
  DEFAULT_INDUSTRY_CONFIG,
  getTermLabel,
  type IndustryTerminology,
} from "@/lib/industry-config";

const EDITION_LABELS: Record<string, string> = {
  sales: "Sales Cloud Edition",
  saas: "SaaS Cloud Edition",
  iaas: "Infrastructure Cloud Edition",
  govcon: "Public Sector Cloud Edition",
  cybersecurity: "Security Cloud Edition",
  msp: "MSP Cloud Edition",
  telecom: "Communications Cloud Edition",
  "energy-utilities": "Energy & Utilities Cloud Edition",
  ecommerce: "Commerce Cloud Edition",
  "aerospace-defense": "Defense Cloud Edition",
  "pharma-life-sciences": "Life Sciences Cloud Edition",
  "property-management": "Property Cloud Edition",
  franchise: "Franchise Cloud Edition",
  staffing: "Staffing Cloud Edition",
  healthcare: "Health Cloud Edition",
  "financial-services": "Financial Services Cloud Edition",
  nonprofit: "Nonprofit Cloud Edition",
  education: "Education Cloud Edition",
  manufacturing: "Manufacturing Cloud Edition",
  retail: "Retail Cloud Edition",
  "real-estate": "Real Estate Edition",
  legal: "Legal Cloud Edition",
  consulting: "Consulting Edition",
  recruitment: "Recruiting Edition",
  media: "Media Cloud Edition",
  custom: "Custom Edition",
};

/**
 * Reads active `industryConfig` from CRMApp via IndustryConfigBridge.
 * Always returns a string — falls back to default terminology keys.
 */
export function useCRMTranslation() {
  const industryConfig = useIndustryConfig();

  const t = useCallback(
    (key: keyof IndustryTerminology): string => {
      return getTermLabel(industryConfig, key)
        || getTermLabel(DEFAULT_INDUSTRY_CONFIG, key)
        || DEFAULT_INDUSTRY_CONFIG.terminology[key];
    },
    [industryConfig],
  );

  return useMemo(() => {
    const edition = EDITION_LABELS[industryConfig.id] || "Sales Cloud Edition";
    return {
      t,
      term: industryConfig.terminology,
      industryConfig,
      edition,
      editionTitle: `Meridian — ${edition}`,
    };
  }, [t, industryConfig]);
}
