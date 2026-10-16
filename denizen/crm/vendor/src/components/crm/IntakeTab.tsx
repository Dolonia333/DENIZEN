import { useState, useRef } from "react";
import { T, S, STATUS_META, getLeadPriority, PRIORITY_META, fmt, type Submission, type Quote, type Package, type IntakeQuestion } from "@/lib/crm-data";
import { publicIntakePageUrl } from "@/lib/crm-api";
import { ProposalPDFButton } from "./ProposalPDF";

interface Props {
  submissions: Submission[];
  quotes: Quote[];
  packages: Package[];
  branding: { companyName: string; tagline: string; accentColor: string; logoEmoji: string };
  intakeQuestions: IntakeQuestion[];
  orgSlug?: string | null;
  onStatusChange: (id: number, status: string) => void;
  onAddSubmission: (sub: Submission) => void;
  onAddQuote: (quote: Quote) => void;
  onImportSubmissions: (subs: Submission[]) => void;
}

// Mock AI quote generation that reads intake + packages
function generateAIQuote(sub: Submission, packages: Package[]): {
  recommendedPackage: string;
  lineItems: { id: number; name: string; price: number; unit: string }[];
  monthlyTotal: number; onetimeTotal: number;
  aiReasoning: string; customisations: string[]; upsellNote: string;
} {
  const answers = sub.answers;
  const budget = String(answers["What's your expected monthly budget?"] || answers["budget"] || "").toLowerCase();
  const teamSize = String(answers["How many team members will use the platform?"] || answers["team_size"] || "").toLowerCase();
  const goals = String(answers["What are your primary goals?"] || answers["goals"] || "").toLowerCase();
  const challenge = String(answers["What's your biggest current challenge?"] || answers["challenge"] || "").toLowerCase();
  const timeline = String(answers["How soon are you looking to get started?"] || answers["timeline"] || "").toLowerCase();
  const integrations = String(answers["Which integrations do you need?"] || answers["integrations"] || "").toLowerCase();

  // Score each package against the intake answers
  let bestPkg = packages[0];
  let bestScore = -1;
  const customisations: string[] = [];

  packages.forEach(pkg => {
    let score = 0;
    const mo = pkg.lineItems.filter(l => l.included && l.unit === "/mo").reduce((s, l) => s + l.price, 0);

    // Budget match
    if (budget.includes("2,500") || budget.includes("2500") || budget.includes("enterprise")) {
      if (mo > 1000) score += 3;
    } else if (budget.includes("800") || budget.includes("1000") || budget.includes("pro")) {
      if (mo >= 500 && mo <= 1500) score += 3;
    } else if (budget.includes("300") || budget.includes("500") || budget.includes("starter")) {
      if (mo < 600) score += 3;
    }

    // Team size match
    if (teamSize.includes("50") || teamSize.includes("100") || teamSize.includes("enterprise")) {
      if (pkg.tier === "enterprise") score += 2;
    } else if (teamSize.includes("10") || teamSize.includes("25")) {
      if (pkg.tier === "pro") score += 2;
    } else {
      if (pkg.tier === "starter") score += 2;
    }

    // Best-for tag matching
    pkg.bestFor.forEach(bf => {
      const bfLower = bf.toLowerCase();
      if (goals.includes(bfLower) || challenge.includes(bfLower) || teamSize.includes(bfLower)) score += 1;
    });

    if (score > bestScore) { bestScore = score; bestPkg = pkg; }
  });

  // Build line items from best package
  let items = bestPkg.lineItems.filter(l => l.included).map((l, i) => ({ id: i + 1, name: l.name, price: l.price, unit: l.unit }));

  // Add setup fee if present
  if (bestPkg.setupFee) {
    items.push({ id: items.length + 1, name: "Setup Fee", price: bestPkg.setupFee, unit: "one-time" });
  }

  // Smart customisations based on intake
  if (integrations.includes("salesforce") || integrations.includes("hubspot")) {
    const hasIntegration = items.some(i => i.name.toLowerCase().includes("integration"));
    if (!hasIntegration) {
      const integrationItem = packages.flatMap(p => p.lineItems).find(l => l.name.toLowerCase().includes("integration"));
      if (integrationItem) {
        items.push({ id: items.length + 1, name: integrationItem.name, price: integrationItem.price, unit: integrationItem.unit });
        customisations.push(`Added ${integrationItem.name} since ${integrations.includes("salesforce") ? "Salesforce" : "HubSpot"} migration was mentioned`);
      }
    }
  }

  if (budget.includes("300") || budget.includes("under")) {
    const priorityIdx = items.findIndex(i => i.name.toLowerCase().includes("priority"));
    if (priorityIdx >= 0) {
      items.splice(priorityIdx, 1);
      customisations.push("Removed Priority Support add-on as budget is under $800/mo");
    }
  }

  if (timeline.includes("right away") || timeline.includes("immediately")) {
    customisations.push("Fast-tracked onboarding sessions recommended given immediate start timeline");
  }

  const monthlyTotal = items.filter(i => i.unit === "/mo").reduce((s, i) => s + i.price, 0);
  const onetimeTotal = items.filter(i => i.unit !== "/mo").reduce((s, i) => s + i.price, 0);

  // Build reasoning
  const reasonParts: string[] = [];
  if (budget) reasonParts.push(`Budget of ${budget} aligns with the ${bestPkg.name} tier`);
  if (teamSize) reasonParts.push(`team size of ${teamSize} fits the platform capacity`);
  if (goals) reasonParts.push(`goals around "${goals.slice(0, 40)}" match the feature set`);
  const aiReasoning = `Recommended ${bestPkg.name} because ${reasonParts.join(", ") || "it provides the best value match"}. The package includes ${items.length} line items totaling ${fmt(monthlyTotal)}/mo${onetimeTotal > 0 ? ` plus ${fmt(onetimeTotal)} in one-time fees` : ""}.`;

  const nextTier = packages.find(p => {
    const mo2 = p.lineItems.filter(l => l.included && l.unit === "/mo").reduce((s2, l) => s2 + l.price, 0);
    return mo2 > monthlyTotal;
  });
  const upsellNote = nextTier
    ? `As the team grows, consider upgrading to ${nextTier.name} for additional capacity and features.`
    : "This is the top-tier package — consider custom enterprise add-ons for further scaling.";

  return { recommendedPackage: bestPkg.name, lineItems: items, monthlyTotal, onetimeTotal, aiReasoning, customisations, upsellNote };
}

type View = "list" | "new-intake" | "new-quote" | "import";

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 14px", borderRadius: 8,
  border: `1px solid ${T.bg4}`, background: T.bg3, color: T.text0,
  fontSize: 14, outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block", fontSize: 14, fontWeight: 600, color: T.text2,
  marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.05em",
};
const btnPrimary: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 8, border: "none",
  background: T.accent, color: "#000", fontSize: 14,
  fontWeight: 700, cursor: "pointer",
};
const btnSecondary: React.CSSProperties = {
  padding: "10px 20px", borderRadius: 8,
  border: `1px solid ${T.bg4}`, background: "transparent",
  color: T.text1, fontSize: 14, fontWeight: 600, cursor: "pointer",
};

export function IntakeTab({
  submissions, quotes, packages, branding, intakeQuestions, orgSlug,
  onStatusChange, onAddSubmission, onAddQuote, onImportSubmissions,
}: Props) {
  const [view, setView] = useState<View>("list");
  const [copiedApi, setCopiedApi] = useState(false);
  const [copiedPage, setCopiedPage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const intakePageUrl = orgSlug ? publicIntakePageUrl(orgSlug) : "";

  const publicIntakeExample = orgSlug ? JSON.stringify({
    org_slug: orgSlug,
    clientName: "Jane Smith",
    clientEmail: "jane@example.com",
    company: "Acme Inc",
    answers: { budget: "$500–$1000/mo" },
  }, null, 2) : "";

  // New Intake form state
  const [intakeForm, setIntakeForm] = useState({
    clientName: "", clientEmail: "", company: "",
    answers: {} as Record<string, any>,
  });

  // New Quote form state
  const [quoteForm, setQuoteForm] = useState({
    submissionId: 0, clientName: "", company: "",
    recommendedPackage: packages[0]?.name || "",
    lineItems: [{ id: 1, name: "", price: 0, unit: "/mo" }] as { id: number; name: string; price: number; unit: string }[],
    notes: "", validDays: 30,
  });

  // Import state
  const [importPreview, setImportPreview] = useState<Submission[]>([]);
  const [importError, setImportError] = useState("");

  // AI Quote editing state
  const [aiQuoteEdit, setAiQuoteEdit] = useState<{
    subId: number;
    recommendedPackage: string;
    lineItems: { id: number; name: string; price: number; unit: string }[];
    aiReasoning: string;
    customisations: string[];
    upsellNote: string;
    notes: string;
    discount: { type: 'percent' | 'flat'; value: number; reason: string };
  } | null>(null);
  const [aiGenerating, setAiGenerating] = useState<number | null>(null);

  const handleGenerateAIQuote = (sub: Submission) => {
    setAiGenerating(sub.id);
    // Simulate AI thinking delay
    setTimeout(() => {
      const result = generateAIQuote(sub, packages);
      setAiQuoteEdit({
        subId: sub.id,
        recommendedPackage: result.recommendedPackage,
        lineItems: result.lineItems,
        aiReasoning: result.aiReasoning,
        customisations: result.customisations,
        upsellNote: result.upsellNote,
        notes: "",
        discount: { type: 'percent', value: 0, reason: "" },
      });
      setAiGenerating(null);
    }, 800);
  };

  const handleSwapPackage = (pkgName: string) => {
    if (!aiQuoteEdit) return;
    const pkg = packages.find(p => p.name === pkgName);
    if (!pkg) return;
    const items = pkg.lineItems.filter(l => l.included).map((l, i) => ({ id: i + 1, name: l.name, price: l.price, unit: l.unit }));
    if (pkg.setupFee) items.push({ id: items.length + 1, name: "Setup Fee", price: pkg.setupFee, unit: "one-time" });
    setAiQuoteEdit(prev => prev && { ...prev, recommendedPackage: pkgName, lineItems: items });
  };

  const saveAIQuote = () => {
    if (!aiQuoteEdit) return;
    const sub = submissions.find(s => s.id === aiQuoteEdit.subId);
    if (!sub) return;

    let monthlyTotal = aiQuoteEdit.lineItems.filter(i => i.unit === "/mo").reduce((s, i) => s + i.price, 0);
    let onetimeTotal = aiQuoteEdit.lineItems.filter(i => i.unit !== "/mo").reduce((s, i) => s + i.price, 0);

    // Apply discount
    if (aiQuoteEdit.discount.value > 0) {
      if (aiQuoteEdit.discount.type === 'percent') {
        monthlyTotal = Math.round(monthlyTotal * (1 - aiQuoteEdit.discount.value / 100));
      } else {
        monthlyTotal = Math.max(0, monthlyTotal - aiQuoteEdit.discount.value);
      }
    }

    const newQuote: Quote = {
      id: Date.now(), submissionId: aiQuoteEdit.subId,
      clientName: sub.clientName, company: sub.company,
      createdAt: new Date().toISOString().split("T")[0], status: "quoted",
      recommendedPackage: aiQuoteEdit.recommendedPackage,
      aiReasoning: aiQuoteEdit.aiReasoning,
      lineItems: aiQuoteEdit.lineItems, monthlyTotal, onetimeTotal,
      notes: aiQuoteEdit.notes,
      validUntil: new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0],
      portalToken: `tok_${Date.now()}`, portalViewedAt: null, portalSignedAt: null,
      portalPaidAt: null, signature: null, portalActivity: [],
      customisations: aiQuoteEdit.customisations, upsellNote: aiQuoteEdit.upsellNote,
      discount: aiQuoteEdit.discount.value > 0 ? aiQuoteEdit.discount : undefined,
    };
    onAddQuote(newQuote);
    onStatusChange(aiQuoteEdit.subId, "quoted");
    setAiQuoteEdit(null);
  };

  const resetIntakeForm = () => {
    setIntakeForm({ clientName: "", clientEmail: "", company: "", answers: {} });
    setView("list");
  };

  const handleSubmitIntake = () => {
    if (!intakeForm.clientName || !intakeForm.clientEmail) return;
    const newSub: Submission = {
      id: Date.now(),
      clientName: intakeForm.clientName,
      clientEmail: intakeForm.clientEmail,
      company: intakeForm.company,
      submittedAt: new Date().toISOString().split("T")[0],
      status: "new",
      assignedTo: "",
      teamNote: "",
      answers: intakeForm.answers,
      quoteId: null,
    };
    onAddSubmission(newSub);
    resetIntakeForm();
  };

  const handleSubmitQuote = () => {
    if (!quoteForm.clientName) return;
    const validItems = quoteForm.lineItems.filter(i => i.name && i.price > 0);
    const monthlyTotal = validItems.filter(i => i.unit === "/mo").reduce((s, i) => s + i.price, 0);
    const onetimeTotal = validItems.filter(i => i.unit !== "/mo").reduce((s, i) => s + i.price, 0);
    const validUntil = new Date(Date.now() + quoteForm.validDays * 86400000).toISOString().split("T")[0];

    const newQuote: Quote = {
      id: Date.now(),
      submissionId: quoteForm.submissionId,
      clientName: quoteForm.clientName,
      company: quoteForm.company,
      createdAt: new Date().toISOString().split("T")[0],
      status: "new",
      recommendedPackage: quoteForm.recommendedPackage,
      aiReasoning: "",
      lineItems: validItems,
      monthlyTotal, onetimeTotal,
      notes: quoteForm.notes,
      validUntil,
      portalToken: `tok_${Date.now()}`,
      portalViewedAt: null, portalSignedAt: null, portalPaidAt: null,
      signature: null,
      portalActivity: [],
    };
    onAddQuote(newQuote);
    setQuoteForm({
      submissionId: 0, clientName: "", company: "",
      recommendedPackage: packages[0]?.name || "",
      lineItems: [{ id: 1, name: "", price: 0, unit: "/mo" }],
      notes: "", validDays: 30,
    });
    setView("list");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError("");

    if (file.name.endsWith(".csv")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result as string;
          const lines = text.split("\n").filter(l => l.trim());
          if (lines.length < 2) { setImportError("CSV must have a header row and at least one data row."); return; }
          const headers = lines[0].split(",").map(h => h.trim().toLowerCase());
          const nameIdx = headers.findIndex(h => h.includes("name") && !h.includes("email"));
          const emailIdx = headers.findIndex(h => h.includes("email"));
          const companyIdx = headers.findIndex(h => h.includes("company") || h.includes("org"));
          if (nameIdx === -1) { setImportError("CSV must have a 'name' column."); return; }

          const parsed: Submission[] = lines.slice(1).map((line, i) => {
            const cols = line.split(",").map(c => c.trim().replace(/^"|"$/g, ""));
            const answers: Record<string, any> = {};
            headers.forEach((h, idx) => {
              if (idx !== nameIdx && idx !== emailIdx && idx !== companyIdx && cols[idx]) {
                answers[h] = cols[idx];
              }
            });
            return {
              id: Date.now() + i,
              clientName: cols[nameIdx] || "Unknown",
              clientEmail: cols[emailIdx] || "",
              company: companyIdx >= 0 ? cols[companyIdx] || "" : "",
              submittedAt: new Date().toISOString().split("T")[0],
              status: "new",
              assignedTo: "",
              teamNote: "",
              answers,
              quoteId: null,
            };
          }).filter(s => s.clientName && s.clientName !== "Unknown");
          setImportPreview(parsed);
        } catch { setImportError("Failed to parse CSV file."); }
      };
      reader.readAsText(file);
    } else if (file.name.endsWith(".json")) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target?.result as string);
          const arr = Array.isArray(data) ? data : [data];
          const parsed: Submission[] = arr.map((item: any, i: number) => ({
            id: Date.now() + i,
            clientName: item.clientName || item.name || "Unknown",
            clientEmail: item.clientEmail || item.email || "",
            company: item.company || item.organization || "",
            submittedAt: item.submittedAt || new Date().toISOString().split("T")[0],
            status: "new",
            assignedTo: "",
            teamNote: "",
            answers: item.answers || {},
            quoteId: null,
          }));
          setImportPreview(parsed);
        } catch { setImportError("Failed to parse JSON file."); }
      };
      reader.readAsText(file);
    } else {
      setImportError("Supported formats: .csv, .json");
    }
    e.target.value = "";
  };

  const confirmImport = () => {
    onImportSubmissions(importPreview);
    setImportPreview([]);
    setView("list");
  };

  // Fill quote form from a submission
  const createQuoteFromSubmission = (sub: Submission) => {
    setQuoteForm(prev => ({
      ...prev,
      submissionId: sub.id,
      clientName: sub.clientName,
      company: sub.company,
    }));
    setView("new-quote");
  };

  const renderPublicIntakeBanner = () => {
    if (!orgSlug || view !== "list") return null;
    return (
      <div style={{
        marginBottom: 20, padding: "16px 18px", borderRadius: 12,
        background: `${T.blue}12`, border: `1px solid ${T.blue}33`,
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 6 }}>🌐 Public intake form</div>
        <div style={{ fontSize: 14, color: T.text2, marginBottom: 10 }}>
          Embed on your site or connect a form builder. Submissions land here automatically via{" "}
          <code style={{ color: T.accent }}>POST /api/crm/intake</code> with org slug <strong>{orgSlug}</strong>.
        </div>
        <pre style={{
          margin: 0, padding: 12, borderRadius: 8, background: T.bg0, border: `1px solid ${T.bg4}`,
          fontSize: 14, color: T.text2, overflowX: "auto", maxHeight: 140,
        }}>{publicIntakeExample}</pre>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <button aria-label="Action"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(publicIntakeExample).then(() => {
                setCopiedApi(true);
                setTimeout(() => setCopiedApi(false), 1800);
              });
            }}
            style={{ ...btnSecondary, fontSize: 14 }}
          >
            {copiedApi ? "✓ Copied JSON" : "Copy example JSON"}
          </button>
          {intakePageUrl && (
            <>
              <a aria-label="Link" href={intakePageUrl} target="_blank" rel="noreferrer" style={{ ...btnPrimary, fontSize: 14, textDecoration: "none", display: "inline-block" }}>
                Open hosted form ↗
              </a>
              <button aria-label="Action"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(intakePageUrl).then(() => {
                    setCopiedPage(true);
                    setTimeout(() => setCopiedPage(false), 1800);
                  });
                }}
                style={{ ...btnSecondary, fontSize: 14 }}
              >
                {copiedPage ? "✓ Copied URL" : "Copy form URL"}
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

  // ─── Header with action buttons ───
  const renderHeader = () => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Intake & Quotes</h1>
        <p style={{ fontSize: 14, color: T.text2, marginTop: 4 }}>{submissions.length} submissions · {quotes.length} quotes generated</p>
      </div>
      {view === "list" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button aria-label="Action" onClick={() => setView("new-intake")} style={btnPrimary}>+ New Intake</button>
          <button aria-label="Action" onClick={() => setView("new-quote")} style={{ ...btnPrimary, background: `${T.purple}` }}>+ New Quote</button>
          <button aria-label="Action" onClick={() => setView("import")} style={btnSecondary}>↑ Import</button>
        </div>
      )}
      {view !== "list" && (
        <button aria-label="Action" onClick={() => { setView("list"); setImportPreview([]); setImportError(""); }} style={btnSecondary}>← Back to List</button>
      )}
    </div>
  );

  // ─── New Intake Form ───
  const renderNewIntake = () => (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 12, padding: 28, maxWidth: 680 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>📋 New Intake Submission</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div>
          <label style={labelStyle}>Client Name *</label>
          <input style={inputStyle} value={intakeForm.clientName} onChange={e = aria-label="input"> setIntakeForm(f => ({ ...f, clientName: e.target.value }))} placeholder="John Smith" />
        </div>
        <div>
          <label style={labelStyle}>Email *</label>
          <input style={inputStyle} type="email" value={intakeForm.clientEmail} onChange={e = aria-label="email"> setIntakeForm(f => ({ ...f, clientEmail: e.target.value }))} placeholder="john@company.com" />
        </div>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Company</label>
          <input style={inputStyle} value={intakeForm.company} onChange={e = aria-label="input"> setIntakeForm(f => ({ ...f, company: e.target.value }))} placeholder="Acme Corp" />
        </div>
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 12 }}>Intake Questions</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {intakeQuestions.map(q => (
          <div key={q.id}>
            <label style={labelStyle}>{q.icon} {q.label} {q.required && "*"}</label>
            {q.type === "text" && (
              <input style={inputStyle} value={intakeForm.answers[q.label] || ""} onChange={e = aria-label="input"> setIntakeForm(f => ({ ...f, answers: { ...f.answers, [q.label]: e.target.value } }))} />
            )}
            {q.type === "textarea" && (
              <textarea style={{ ...inputStyle, minHeight: 70, resize: "vertical" }} value={intakeForm.answers[q.label] || ""} onChange={e = aria-label="textarea"> setIntakeForm(f => ({ ...f, answers: { ...f.answers, [q.label]: e.target.value } }))} />
            )}
            {q.type === "select" && (
              <select style={inputStyle} value={intakeForm.answers[q.label] || ""} onChange={e => setIntakeForm(f => ({ ...f, answers: { ...f.answers, [q.label]: e.target.value } }))}>
                <option value="">Select...</option>
                {q.options?.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            {q.type === "multiselect" && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {q.options?.map(o => {
                  const selected = (intakeForm.answers[q.label] || []) as string[];
                  const isSelected = selected.includes(o);
                  return (
                    <button aria-label="Action" key={o} type="button" onClick={() => {
                      const current = (intakeForm.answers[q.label] || []) as string[];
                      const next = isSelected ? current.filter(x => x !== o) : [...current, o];
                      setIntakeForm(f => ({ ...f, answers: { ...f.answers, [q.label]: next } }));
                    }} style={{
                      padding: "6px 12px", borderRadius: 6, fontSize: 14, fontWeight: 600, cursor: "pointer",
                      border: `1px solid ${isSelected ? T.accent : T.bg4}`,
                      background: isSelected ? `${T.accent}22` : T.bg3,
                      color: isSelected ? T.accent : T.text2,
                    }}>
                      {isSelected ? "✓ " : ""}{o}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
        <button aria-label="Action" onClick={handleSubmitIntake} disabled={!intakeForm.clientName || !intakeForm.clientEmail} style={{ ...btnPrimary, opacity: (!intakeForm.clientName || !intakeForm.clientEmail) ? 0.5 : 1 }}>
          Submit Intake
        </button>
        <button aria-label="Action" onClick={resetIntakeForm} style={btnSecondary}>Cancel</button>
      </div>
    </div>
  );

  // ─── New Quote Form ───
  const renderNewQuote = () => (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 12, padding: 28, maxWidth: 720 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 20 }}>💰 Create Quote</h2>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <div>
          <label style={labelStyle}>Client Name *</label>
          <input style={inputStyle} value={quoteForm.clientName} onChange={e = aria-label="input"> setQuoteForm(f => ({ ...f, clientName: e.target.value }))} placeholder="Client name" />
        </div>
        <div>
          <label style={labelStyle}>Company</label>
          <input style={inputStyle} value={quoteForm.company} onChange={e = aria-label="input"> setQuoteForm(f => ({ ...f, company: e.target.value }))} placeholder="Company" />
        </div>
        <div>
          <label style={labelStyle}>Recommended Package</label>
          <select style={inputStyle} value={quoteForm.recommendedPackage} onChange={e => setQuoteForm(f => ({ ...f, recommendedPackage: e.target.value }))}>
            {packages.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
            <option value="Custom">Custom</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>Valid For (days)</label>
          <input style={inputStyle} type="number" value={quoteForm.validDays} onChange={e = aria-label="number"> setQuoteForm(f => ({ ...f, validDays: Number(e.target.value) || 30 }))} />
        </div>
      </div>

      {/* Prefill from package */}
      {quoteForm.recommendedPackage !== "Custom" && (
        <button aria-label="Action"
          onClick={() => {
            const pkg = packages.find(p => p.name === quoteForm.recommendedPackage);
            if (pkg) {
              setQuoteForm(f => ({
                ...f,
                lineItems: pkg.lineItems.filter(i => i.included).map((i, idx) => ({
                  id: idx + 1, name: i.name, price: i.price, unit: i.unit || "/mo",
                })),
              }));
            }
          }}
          style={{ ...btnSecondary, marginBottom: 16, fontSize: 14 }}
        >
          ⚡ Pre-fill from {quoteForm.recommendedPackage} package
        </button>
      )}

      <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 12 }}>Line Items</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
        {quoteForm.lineItems.map((item, idx) => (
          <div key={item.id} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input style={{ ...inputStyle, flex: 2 }} value={item.name} placeholder="Service name"
              onChange={e = aria-label="Service name"> {
                const items = [...quoteForm.lineItems];
                items[idx] = { ...items[idx], name: e.target.value };
                setQuoteForm(f => ({ ...f, lineItems: items }));
              }} />
            <input style={{ ...inputStyle, flex: 0.7 }} type="number" value={item.price || ""} placeholder="Price"
              onChange={e = aria-label="Price"> {
                const items = [...quoteForm.lineItems];
                items[idx] = { ...items[idx], price: Number(e.target.value) || 0 };
                setQuoteForm(f => ({ ...f, lineItems: items }));
              }} />
            <select style={{ ...inputStyle, flex: 0.5 }} value={item.unit}
              onChange={e => {
                const items = [...quoteForm.lineItems];
                items[idx] = { ...items[idx], unit: e.target.value };
                setQuoteForm(f => ({ ...f, lineItems: items }));
              }}>
              <option value="/mo">/mo</option>
              <option value="one-time">one-time</option>
              <option value="/yr">/yr</option>
            </select>
            <button aria-label="Action" onClick={() => setQuoteForm(f => ({ ...f, lineItems: f.lineItems.filter((_, i) => i !== idx) }))}
              style={{ background: "none", border: "none", color: T.red, fontSize: 16, cursor: "pointer", padding: 4 }}>✕</button>
          </div>
        ))}
        <button aria-label="Action" onClick={() => setQuoteForm(f => ({ ...f, lineItems: [...f.lineItems, { id: Date.now(), name: "", price: 0, unit: "/mo" }] }))}
          style={{ ...btnSecondary, fontSize: 14, alignSelf: "flex-start" }}>+ Add Line Item</button>
      </div>

      {/* Totals preview */}
      {(() => {
        const monthly = quoteForm.lineItems.filter(i => i.unit === "/mo").reduce((s, i) => s + i.price, 0);
        const onetime = quoteForm.lineItems.filter(i => i.unit !== "/mo" && i.unit !== "/yr").reduce((s, i) => s + i.price, 0);
        return monthly + onetime > 0 ? (
          <div style={{ background: T.bg3, borderRadius: 8, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 24, fontSize: 14 }}>
            <span style={{ color: T.text2 }}>Monthly: <strong style={{ color: T.accent }}>{fmt(monthly)}/mo</strong></span>
            {onetime > 0 && <span style={{ color: T.text2 }}>One-time: <strong style={{ color: T.text0 }}>{fmt(onetime)}</strong></span>}
            <span style={{ color: T.text2 }}>First month: <strong style={{ color: T.green }}>{fmt(monthly + onetime)}</strong></span>
          </div>
        ) : null;
      })()}

      <div style={{ marginBottom: 20 }}>
        <label style={labelStyle}>Notes</label>
        <textarea style={{ ...inputStyle, minHeight: 60, resize: "vertical" }} value={quoteForm.notes}
          onChange={e = aria-label="textarea"> setQuoteForm(f => ({ ...f, notes: e.target.value }))} placeholder="Additional notes for the client..." />
      </div>

      <div style={{ display: "flex", gap: 10 }}>
        <button aria-label="Action" onClick={handleSubmitQuote} disabled={!quoteForm.clientName || quoteForm.lineItems.filter(i => i.name).length === 0}
          style={{ ...btnPrimary, background: T.purple, opacity: (!quoteForm.clientName) ? 0.5 : 1 }}>
          Create Quote
        </button>
        <button aria-label="Action" onClick={() => setView("list")} style={btnSecondary}>Cancel</button>
      </div>
    </div>
  );

  // ─── Import View ───
  const renderImport = () => (
    <div style={{ background: T.bg2, border: `1px solid ${T.bg4}`, borderRadius: 12, padding: 28, maxWidth: 720 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 8 }}>↑ Import Intake Submissions</h2>
      <p style={{ fontSize: 14, color: T.text2, marginBottom: 20 }}>Upload a CSV or JSON file with intake form submissions.</p>

      <div style={{
        border: `2px dashed ${T.bg4}`, borderRadius: 12, padding: "40px 20px",
        textAlign: "center", cursor: "pointer", marginBottom: 16,
        background: T.bg3, transition: "border-color 0.2s",
      }} onClick={() => fileRef.current?.click()}
        onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = T.accent; }}
        onDragLeave={e => { e.currentTarget.style.borderColor = T.bg4; }}
        onDrop={e => {
          e.preventDefault();
          e.currentTarget.style.borderColor = T.bg4;
          const file = e.dataTransfer.files[0];
          if (file) {
            const fakeEvent = { target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>;
            handleFileUpload(fakeEvent);
          }
        }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📁</div>
        <div style={{ fontSize: 14, color: T.text1, fontWeight: 600 }}>Drop file here or click to browse</div>
        <div style={{ fontSize: 14, color: T.text3, marginTop: 4 }}>Supports .csv and .json</div>
      </div>
      <input ref={fileRef} type="file" accept=".csv,.json" style={{ display: "none" }} onChange={handleFileUpload} / aria-label="file" />

      {importError && (
        <div style={{ background: `${T.red}14`, border: `1px solid ${T.red}33`, borderRadius: 8, padding: "10px 14px", fontSize: 14, color: T.red, marginBottom: 16 }}>
          ⚠ {importError}
        </div>
      )}

      {/* CSV format guide */}
      <div style={{ background: T.bg3, borderRadius: 8, padding: "14px 16px", marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text2, marginBottom: 6 }}>CSV Format</div>
        <code style={{ fontSize: 14, color: T.accent, display: "block", lineHeight: 1.6 }}>
          name,email,company,budget,timeline<br />
          John Smith,john@co.com,Acme,$800-$2500/mo,Within 30 days
        </code>
      </div>

      {/* Preview imported data */}
      {importPreview.length > 0 && (
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: T.text0, marginBottom: 12 }}>
            Preview ({importPreview.length} records)
          </div>
          <div style={{ maxHeight: 300, overflow: "auto", marginBottom: 16 }}>
            {importPreview.map((sub, i) => (
              <div key={i} style={{
                background: T.bg3, borderRadius: 8, padding: "10px 14px", marginBottom: 6,
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>{sub.clientName}</div>
                  <div style={{ fontSize: 14, color: T.text2 }}>{sub.clientEmail} · {sub.company}</div>
                </div>
                <div style={{ fontSize: 14, color: T.text3 }}>{Object.keys(sub.answers).length} fields</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button aria-label="Action" onClick={confirmImport} style={btnPrimary}>Import {importPreview.length} Submissions</button>
            <button aria-label="Action" onClick={() => setImportPreview([])} style={btnSecondary}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );

  // ─── Submission List ───
  const renderList = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {submissions.length === 0 && (
        <div style={{ textAlign: "center", padding: 48, color: T.text3 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 14 }}>No submissions yet</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>Create a new intake or import from CSV/JSON</div>
        </div>
      )}
      {submissions.map(sub => {
        const priority = getLeadPriority(sub);
        const [pLabel, pColor, pBg] = PRIORITY_META[priority];
        const sm = STATUS_META[sub.status] || STATUS_META.new;
        const quote = quotes.find(q => q.submissionId === sub.id || q.id === sub.quoteId);

        return (
          <div key={sub.id} style={{
            background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
            border: `1px solid ${T.bg4}`, borderRadius: 12, padding: "20px 22px",
          }}>
            <div className="crm-intake-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>{sub.clientName}</span>
                  <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 6, background: pBg, color: pColor, fontWeight: 600 }}>{pLabel}</span>
                  <span style={{ fontSize: 14, padding: "2px 8px", borderRadius: 6, background: sm.bg, color: sm.color, fontWeight: 600 }}>{sm.label}</span>
                </div>
                <div style={{ fontSize: 14, color: T.text2 }}>{sub.company} · {sub.clientEmail}</div>
                <div style={{ fontSize: 14, color: T.text3, marginTop: 2 }}>Submitted {sub.submittedAt}</div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {!quote && (
                  <>
                    <button aria-label="Action" onClick={() => handleGenerateAIQuote(sub)}
                      disabled={aiGenerating === sub.id}
                      style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.accent}44`, background: `${T.accent}14`, color: T.accent, fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: aiGenerating === sub.id ? 0.6 : 1 }}>
                      {aiGenerating === sub.id ? "⏳ Generating..." : "🤖 AI Quote"}
                    </button>
                    <button aria-label="Action" onClick={() => createQuoteFromSubmission(sub)}
                      style={{ padding: "4px 12px", borderRadius: 6, border: `1px solid ${T.purple}44`, background: `${T.purple}14`, color: T.purple, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
                      + Manual Quote
                    </button>
                  </>
                )}
                <select value={sub.status} onChange={e => onStatusChange(sub.id, e.target.value)}
                  style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: 6, color: T.text1, padding: "4px 8px", fontSize: 14 }}>
                  {Object.entries(STATUS_META).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {Object.keys(sub.answers).length > 0 && (
              <div className="crm-intake-answers" style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                {Object.entries(sub.answers).slice(0, 4).map(([q, a]) => (
                  <div key={q} style={{ background: T.bg3, borderRadius: 6, padding: "8px 10px" }}>
                    <div style={{ fontSize: 14, color: T.text3, marginBottom: 2 }}>{q}</div>
                    <div style={{ fontSize: 14, color: T.text1 }}>{Array.isArray(a) ? a.join(", ") : String(a)}</div>
                  </div>
                ))}
              </div>
            )}

            {quote && (
              <div style={{ background: `${T.accent}08`, border: `1px solid ${T.accent}22`, borderRadius: 8, padding: "12px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ fontSize: 14, color: T.accent, fontWeight: 600 }}>✦ Quote: {quote.recommendedPackage} Plan</div>
                  <ProposalPDFButton quote={quote} branding={branding} />
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 14, flexWrap: "wrap" }}>
                  <span style={{ color: T.text0, fontFamily: "'JetBrains Mono', monospace", fontWeight: 700 }}>{fmt(quote.monthlyTotal)}/mo</span>
                  {quote.onetimeTotal > 0 && <span style={{ color: T.text2 }}>+ {fmt(quote.onetimeTotal)} setup</span>}
                  {quote.discount && quote.discount.value > 0 && (
                    <span style={{ color: T.green, fontSize: 14 }}>💸 {quote.discount.type === 'percent' ? `${quote.discount.value}%` : fmt(quote.discount.value)} discount</span>
                  )}
                </div>
                {quote.aiReasoning && (
                  <div style={{ fontSize: 14, color: T.text2, marginTop: 6, lineHeight: 1.5 }}>💡 {quote.aiReasoning}</div>
                )}
                {quote.customisations && quote.customisations.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    {quote.customisations.map((c, i) => (
                      <div key={i} style={{ fontSize: 14, color: T.purple, marginTop: 2 }}>• {c}</div>
                    ))}
                  </div>
                )}
                {quote.upsellNote && (
                  <div style={{ fontSize: 14, color: T.blue, marginTop: 6 }}>⬆ {quote.upsellNote}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div>
      {renderHeader()}
      {renderPublicIntakeBanner()}
      {view === "list" && renderList()}
      {view === "new-intake" && renderNewIntake()}
      {view === "new-quote" && renderNewQuote()}
      {view === "import" && renderImport()}

      {/* ── AI QUOTE EDITOR MODAL ── */}
      {aiQuoteEdit && (
        <div style={S.modalBg} onClick={() => setAiQuoteEdit(null)}>
          <div style={{ ...S.modalBox, width: 720 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 18, fontWeight: 700, color: T.text0, marginBottom: 6 }}>
              🤖 AI-Generated Quote
            </div>
            <div style={{ fontSize: 14, color: T.text2, marginBottom: 20 }}>
              Review and customise before saving
            </div>

            {/* AI Reasoning */}
            <div style={{ background: `${T.accent}08`, border: `1px solid ${T.accent}22`, borderRadius: 8, padding: "12px 16px", marginBottom: 16 }}>
              <div style={{ fontSize: 14, color: T.accent, fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>AI Reasoning</div>
              <div style={{ fontSize: 14, color: T.text1, lineHeight: 1.5 }}>{aiQuoteEdit.aiReasoning}</div>
              {aiQuoteEdit.customisations.length > 0 && (
                <div style={{ marginTop: 8, borderTop: `1px solid ${T.bg4}`, paddingTop: 8 }}>
                  <div style={{ fontSize: 14, color: T.purple, fontWeight: 600, marginBottom: 4 }}>Customisations</div>
                  {aiQuoteEdit.customisations.map((c, i) => (
                    <div key={i} style={{ fontSize: 14, color: T.text2, marginTop: 2 }}>• {c}</div>
                  ))}
                </div>
              )}
              {aiQuoteEdit.upsellNote && (
                <div style={{ fontSize: 14, color: T.blue, marginTop: 8 }}>⬆ {aiQuoteEdit.upsellNote}</div>
              )}
            </div>

            {/* Swap package */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ ...S.label }}>Base Package</div>
                <select value={aiQuoteEdit.recommendedPackage} onChange={e => handleSwapPackage(e.target.value)}
                  style={{ ...S.input }}>
                  {packages.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                  <option value="Custom">Custom</option>
                </select>
              </div>
              <div>
                <div style={{ ...S.label }}>Discount</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <select value={aiQuoteEdit.discount.type} onChange={e => setAiQuoteEdit(prev => prev && { ...prev, discount: { ...prev.discount, type: e.target.value as 'percent' | 'flat' } })}
                    style={{ ...S.input, flex: 0.4 }}>
                    <option value="percent">%</option>
                    <option value="flat">$</option>
                  </select>
                  <input type="number" value={aiQuoteEdit.discount.value || ""} placeholder="0"
                    onChange={e = aria-label="0"> setAiQuoteEdit(prev => prev && { ...prev, discount: { ...prev.discount, value: Number(e.target.value) || 0 } })}
                    style={{ ...S.input, flex: 0.6 }} />
                </div>
              </div>
            </div>

            {aiQuoteEdit.discount.value > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...S.label }}>Discount Reason</div>
                <input value={aiQuoteEdit.discount.reason} onChange={e = aria-label="input"> setAiQuoteEdit(prev => prev && { ...prev, discount: { ...prev.discount, reason: e.target.value } })}
                  placeholder="e.g. Early bird pricing" style={{ ...S.input }} />
              </div>
            )}

            {/* Line items editor */}
            <div style={{ ...S.label }}>Line Items</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
              {aiQuoteEdit.lineItems.map((item, idx) => (
                <div key={item.id} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <input value={item.name} onChange={e = aria-label="input"> setAiQuoteEdit(prev => {
                    if (!prev) return prev;
                    const items = [...prev.lineItems]; items[idx] = { ...items[idx], name: e.target.value }; return { ...prev, lineItems: items };
                  })} style={{ ...S.input, flex: 2 }} />
                  <input type="number" value={item.price || ""} onChange={e = aria-label="number"> setAiQuoteEdit(prev => {
                    if (!prev) return prev;
                    const items = [...prev.lineItems]; items[idx] = { ...items[idx], price: Number(e.target.value) || 0 }; return { ...prev, lineItems: items };
                  })} style={{ ...S.input, flex: 0.6, textAlign: "right" }} />
                  <select value={item.unit} onChange={e => setAiQuoteEdit(prev => {
                    if (!prev) return prev;
                    const items = [...prev.lineItems]; items[idx] = { ...items[idx], unit: e.target.value }; return { ...prev, lineItems: items };
                  })} style={{ ...S.input, flex: 0.5 }}>
                    <option value="/mo">/mo</option>
                    <option value="one-time">one-time</option>
                  </select>
                  <button aria-label="Action" onClick={() => setAiQuoteEdit(prev => prev && { ...prev, lineItems: prev.lineItems.filter((_, i) => i !== idx) })}
                    style={{ background: "none", border: "none", color: T.red, fontSize: 14, cursor: "pointer" }}>✕</button>
                </div>
              ))}
              <button aria-label="Action" onClick={() => setAiQuoteEdit(prev => prev && { ...prev, lineItems: [...prev.lineItems, { id: Date.now(), name: "", price: 0, unit: "/mo" }] })}
                style={{ ...S.btnGhost, fontSize: 14, padding: "4px 10px", alignSelf: "flex-start" }}>+ Add Item</button>
            </div>

            {/* Live totals */}
            {(() => {
              let monthly = aiQuoteEdit.lineItems.filter(i => i.unit === "/mo").reduce((s, i) => s + i.price, 0);
              const onetime = aiQuoteEdit.lineItems.filter(i => i.unit !== "/mo").reduce((s, i) => s + i.price, 0);
              const discountLabel = aiQuoteEdit.discount.value > 0
                ? aiQuoteEdit.discount.type === 'percent'
                  ? `-${aiQuoteEdit.discount.value}%`
                  : `-${fmt(aiQuoteEdit.discount.value)}`
                : null;
              if (aiQuoteEdit.discount.value > 0) {
                monthly = aiQuoteEdit.discount.type === 'percent'
                  ? Math.round(monthly * (1 - aiQuoteEdit.discount.value / 100))
                  : Math.max(0, monthly - aiQuoteEdit.discount.value);
              }
              return (
                <div style={{ background: T.bg3, borderRadius: 8, padding: "12px 16px", marginBottom: 16, display: "flex", gap: 20, fontSize: 14, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ color: T.text2 }}>Monthly: <strong style={{ color: T.accent, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(monthly)}/mo</strong></span>
                  {onetime > 0 && <span style={{ color: T.text2 }}>One-time: <strong style={{ color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>{fmt(onetime)}</strong></span>}
                  {discountLabel && <span style={{ color: T.green, fontSize: 14, fontWeight: 600 }}>💸 {discountLabel}</span>}
                </div>
              );
            })()}

            <div style={{ ...S.label }}>Client-Facing Note</div>
            <textarea value={aiQuoteEdit.notes} onChange={e = aria-label="textarea"> setAiQuoteEdit(prev => prev && { ...prev, notes: e.target.value })}
              placeholder="Additional notes for the client portal..." style={{ ...S.input, minHeight: 50, resize: "vertical", marginBottom: 16 }} />

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button aria-label="Action" onClick={() => setAiQuoteEdit(null)} style={{ ...S.btnGhost, fontSize: 14 }}>Cancel</button>
              <button aria-label="save" onClick={saveAIQuote} style={{ ...S.btn, fontSize: 14 }}>Save Quote</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
