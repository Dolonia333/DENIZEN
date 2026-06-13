import { lazy, Suspense, useEffect, useState } from "react";
import { TabFallback } from "@/components/crm/crm-tab-loaders";

const CRMApp = lazy(() => import("@/components/crm/CRMApp"));
const PortalPage = lazy(() =>
  import("@/components/crm/PortalPage").then((m) => ({ default: m.PortalPage })),
);

function parsePortalHash(hash: string): string | null {
  const m = hash.match(/^#\/portal\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

const Index = () => {
  const [portalToken, setPortalToken] = useState<string | null>(() =>
    typeof window !== "undefined" ? parsePortalHash(window.location.hash) : null
  );

  useEffect(() => {
    const onHash = () => setPortalToken(parsePortalHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (portalToken) {
    return (
      <Suspense fallback={<TabFallback label="Loading portal…" />}>
        <PortalPage token={portalToken} />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<TabFallback label="Loading Meridian CRM…" />}>
      <CRMApp />
    </Suspense>
  );
};

export default Index;
