/**
 * Thin React bridge so child components read `industryConfig` from CRMApp
 * without using legacy crm-context.tsx.
 */
import { createContext, useContext, type ReactNode } from "react";
import { DEFAULT_INDUSTRY_CONFIG, type IndustryConfig } from "@/lib/industry-config";

const IndustryConfigContext = createContext<IndustryConfig>(DEFAULT_INDUSTRY_CONFIG);

export function IndustryConfigBridge({
  config,
  children,
}: {
  config: IndustryConfig;
  children: ReactNode;
}) {
  return (
    <IndustryConfigContext.Provider value={config}>
      {children}
    </IndustryConfigContext.Provider>
  );
}

export function useIndustryConfig(): IndustryConfig {
  return useContext(IndustryConfigContext);
}
