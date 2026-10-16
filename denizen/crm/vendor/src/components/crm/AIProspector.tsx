import { useState } from "react";
import { T, S } from "@/lib/crm-data";
import { useCRMTranslation } from "@/hooks/use-crm-translation";

export interface ProspectorLead {
  id: string;
  name: string;
  company: string;
  email: string;
  dealTitle: string;
  value: number;
  source: string;
  signal: string;
}

const MOCK_RESULTS: ProspectorLead[] = [
  {
    id: "p1",
    name: "Elena Vasquez",
    company: "Northwind Analytics",
    email: "elena.vasquez@northwind.io",
    dealTitle: "Northwind — Platform Expansion",
    value: 42000,
    source: "LinkedIn intent",
    signal: "Hiring 3 RevOps roles · Series B",
  },
  {
    id: "p2",
    name: "James Okonkwo",
    company: "Helix Biotech",
    email: "j.okonkwo@helixbio.com",
    dealTitle: "Helix — Compliance Automation",
    value: 28500,
    source: "News mention",
    signal: "FDA audit announced · budget cycle Q3",
  },
  {
    id: "p3",
    name: "Priya Shah",
    company: "Summit Retail Group",
    email: "priya@summitretail.co",
    dealTitle: "Summit — Omnichannel Rollout",
    value: 61000,
    source: "Web technographics",
    signal: "Shopify Plus migration · 120 stores",
  },
];

interface Props {
  onImportLead: (lead: ProspectorLead) => void;
}

export function AIProspector({ onImportLead }: Props) {
  const { t } = useCRMTranslation();
  const [query, setQuery] = useState("");
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState<ProspectorLead[]>([]);
  const [importedIds, setImportedIds] = useState<Set<string>>(new Set());

  const cardStyle = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`,
    borderRadius: T.radius.lg,
    padding: "20px 22px",
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || scanning) return;
    setScanning(true);
    setResults([]);
    setTimeout(() => {
      setResults(MOCK_RESULTS);
      setScanning(false);
    }, 4000);
  };

  const handleImport = (lead: ProspectorLead) => {
    onImportLead(lead);
    setImportedIds((prev) => new Set(prev).add(lead.id));
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>
          🔍 AI Lead Prospector
        </h1>
        <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>
          Describe your ideal {t("contact").toLowerCase()} in plain English — we simulate a web scan and surface importable opportunities.
        </p>
      </div>

      <form onSubmit={handleSearch} style={{ ...cardStyle, marginBottom: 16 }}>
        <label style={{ ...S.label as React.CSSProperties, display: "block", marginBottom: 8 }}>
          Natural language search
        </label>
        <textarea
          value={query}
          onChange={(e) = aria-label="textarea"> setQuery(e.target.value)}
          placeholder={`e.g. "Healthcare SaaS companies in Texas with 50–200 employees looking for CRM"`}
          style={{
            width: "100%",
            minHeight: 88,
            background: T.bg3,
            color: T.text1,
            border: `1px solid ${T.bg4}`,
            borderRadius: T.radius.md,
            padding: 12,
            fontSize: 14,
            fontFamily: "inherit",
            resize: "vertical",
            marginBottom: 12,
          }}
        />
        <button aria-label="Action"
          type="submit"
          disabled={scanning || !query.trim()}
          style={{
            ...S.btn as React.CSSProperties,
            opacity: scanning || !query.trim() ? 0.6 : 1,
            cursor: scanning || !query.trim() ? "not-allowed" : "pointer",
          }}
        >
          {scanning ? "Scanning Web…" : "Run Prospector Scan"}
        </button>
      </form>

      {scanning && (
        <div style={{
          ...cardStyle,
          textAlign: "center",
          padding: "40px 20px",
          marginBottom: 16,
        }}>
          <div style={{
            width: 40,
            height: 40,
            border: `3px solid ${T.bg4}`,
            borderTopColor: T.purple,
            borderRadius: "50%",
            margin: "0 auto 16px",
            animation: "spin 0.9s linear infinite",
          }} />
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>Scanning Web…</div>
          <div style={{ fontSize: 14, color: T.text3, marginTop: 6 }}>Matching signals across public sources</div>
        </div>
      )}

      {results.length > 0 && !scanning && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text2 }}>
            {results.length} prospects matched — import to launch your outreach loop
          </div>
          {results.map((lead) => {
            const imported = importedIds.has(lead.id);
            return (
              <div key={lead.id} style={cardStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>{lead.name}</div>
                    <div style={{ fontSize: 14, color: T.text2, marginTop: 2 }}>{lead.company} · {lead.email}</div>
                    <div style={{ fontSize: 14, color: T.text3, marginTop: 6 }}>{lead.signal}</div>
                    <div style={{ fontSize: 14, color: T.purple, marginTop: 4 }}>Source: {lead.source}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontWeight: 800, color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>
                      ${lead.value.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>Est. {t("deal")}</div>
                  </div>
                </div>
                <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
                  <button aria-label="Action"
                    type="button"
                    disabled={imported}
                    onClick={() => handleImport(lead)}
                    style={{
                      ...(S.btnPurple as React.CSSProperties),
                      opacity: imported ? 0.55 : 1,
                      cursor: imported ? "default" : "pointer",
                      fontSize: 14,
                      padding: "8px 16px",
                    }}
                  >
                    {imported ? "✓ Imported & Loop Started" : "Import & Launch Loop"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
