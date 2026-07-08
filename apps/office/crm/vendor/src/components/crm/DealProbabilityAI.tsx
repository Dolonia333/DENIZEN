import { useMemo } from "react";
import { T, fmt, STAGES, type Deal, type Contact, type EmailLogEntry, type Note } from "@/lib/crm-data";

interface DealScore {
  deal: Deal;
  aiProbability: number;
  confidence: "high" | "medium" | "low";
  factors: { label: string; impact: number; emoji: string }[];
  recommendation: string;
}

interface Props {
  deals: Deal[];
  contacts: Contact[];
  emailLog: EmailLogEntry[];
  notes: Note[];
}

function analyzeDeal(deal: Deal, contacts: Contact[], emailLog: EmailLogEntry[], notes: Note[], allDeals: Deal[]): DealScore {
  const factors: { label: string; impact: number; emoji: string }[] = [];
  let score = 50; // baseline

  // 1. Stage progression bonus
  const stageIndex = STAGES.indexOf(deal.stage);
  const stageBonus = stageIndex * 12;
  factors.push({ label: `Stage: ${deal.stage} (${stageIndex + 1}/${STAGES.length})`, impact: stageBonus, emoji: "📊" });
  score += stageBonus;

  // 2. Days in stage penalty
  if (deal.daysInStage > 21) {
    factors.push({ label: `Stale: ${deal.daysInStage} days in stage`, impact: -20, emoji: "⏳" });
    score -= 20;
  } else if (deal.daysInStage > 14) {
    factors.push({ label: `Aging: ${deal.daysInStage} days in stage`, impact: -10, emoji: "⏳" });
    score -= 10;
  } else if (deal.daysInStage < 5) {
    factors.push({ label: `Fresh: ${deal.daysInStage} days in stage`, impact: 8, emoji: "⚡" });
    score += 8;
  }

  // 3. Contact engagement
  const contact = contacts.find(c => c.name === deal.contact);
  if (contact) {
    const emails = emailLog.filter(e => e.contactId === contact.id || e.to === contact.name);
    const opens = emails.reduce((s, e) => s + (e.opens?.length || 0), 0);
    if (opens >= 3) {
      factors.push({ label: `High engagement: ${opens} email opens`, impact: 15, emoji: "📧" });
      score += 15;
    } else if (opens >= 1) {
      factors.push({ label: `Some engagement: ${opens} email opens`, impact: 8, emoji: "📧" });
      score += 8;
    } else if (emails.length > 0) {
      factors.push({ label: "Emails sent but no opens", impact: -8, emoji: "📧" });
      score -= 8;
    }

    // Contact score influence
    if (contact.score >= 80) {
      factors.push({ label: `Hot lead (score: ${contact.score})`, impact: 12, emoji: "🔥" });
      score += 12;
    } else if (contact.score < 40) {
      factors.push({ label: `Cold lead (score: ${contact.score})`, impact: -10, emoji: "❄️" });
      score -= 10;
    }

    // Recent contact
    const daysSince = Math.floor((Date.now() - new Date(contact.lastContact).getTime()) / 86400000);
    if (daysSince < 7) {
      factors.push({ label: `Recently contacted (${daysSince}d ago)`, impact: 10, emoji: "✅" });
      score += 10;
    } else if (daysSince > 30) {
      factors.push({ label: `No contact in ${daysSince} days`, impact: -15, emoji: "⚠️" });
      score -= 15;
    }

    // Enterprise tag boost
    if (contact.tags?.includes("Enterprise")) {
      factors.push({ label: "Enterprise account", impact: 8, emoji: "🏢" });
      score += 8;
    }
  }

  // 4. Notes & activity
  const dealNotes = notes.filter(n => n.contact === deal.contact);
  if (dealNotes.length >= 3) {
    factors.push({ label: `Active: ${dealNotes.length} notes logged`, impact: 10, emoji: "📝" });
    score += 10;
  } else if (dealNotes.length === 0) {
    factors.push({ label: "No notes logged", impact: -8, emoji: "📝" });
    score -= 8;
  }

  // 5. Deal value vs average (large deals take longer)
  const avgValue = allDeals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).reduce((s, d) => s + d.value, 0) / Math.max(1, allDeals.length);
  if (deal.value > avgValue * 2) {
    factors.push({ label: `High value (${fmt(deal.value)} vs avg ${fmt(avgValue)})`, impact: -5, emoji: "💰" });
    score -= 5;
  }

  // 6. Close date proximity
  const daysToClose = Math.floor((new Date(deal.closeDate).getTime() - Date.now()) / 86400000);
  if (daysToClose < 0) {
    factors.push({ label: `Past due by ${Math.abs(daysToClose)} days`, impact: -12, emoji: "🚨" });
    score -= 12;
  } else if (daysToClose < 14) {
    factors.push({ label: `Closing soon (${daysToClose} days)`, impact: 5, emoji: "🎯" });
    score += 5;
  }

  // 7. Health indicator
  if (deal.health === "at-risk") {
    factors.push({ label: "Marked at-risk", impact: -15, emoji: "⚠️" });
    score -= 15;
  }

  // Similar deals analysis
  const wonDeals = allDeals.filter(d => d.stage === "Closed Won");
  const lostDeals = allDeals.filter(d => d.stage === "Closed Lost");
  if (wonDeals.length + lostDeals.length > 0) {
    const winRate = wonDeals.length / (wonDeals.length + lostDeals.length);
    factors.push({ label: `Historical win rate: ${Math.round(winRate * 100)}%`, impact: Math.round((winRate - 0.5) * 20), emoji: "📈" });
    score += Math.round((winRate - 0.5) * 20);
  }

  const aiProbability = Math.max(5, Math.min(95, Math.round(score)));
  const confidence: "high" | "medium" | "low" = factors.length >= 6 ? "high" : factors.length >= 4 ? "medium" : "low";

  let recommendation = "";
  if (aiProbability >= 75) recommendation = "Strong position. Focus on closing mechanics and contract terms.";
  else if (aiProbability >= 50) recommendation = "Good potential. Increase engagement frequency and address objections.";
  else if (aiProbability >= 30) recommendation = "Needs attention. Schedule a discovery call to re-qualify.";
  else recommendation = "At risk. Consider re-engaging or deprioritizing.";

  return { deal, aiProbability, confidence, factors: factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)), recommendation };
}

export function DealProbabilityAI({ deals, contacts, emailLog, notes }: Props) {
  const openDeals = deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage));
  
  const scores = useMemo(() => 
    openDeals.map(d => analyzeDeal(d, contacts, emailLog, notes, deals))
      .sort((a, b) => b.aiProbability - a.aiProbability),
    [openDeals, contacts, emailLog, notes, deals]
  );

  const confColors = { high: T.green, medium: T.accent, low: T.red };
  const confLabels = { high: "High Confidence", medium: "Medium", low: "Low Data" };

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: T.text0, margin: 0 }}>🤖 AI Deal Probability</h2>
        <p style={{ fontSize: 12, color: T.text3, marginTop: 4 }}>
          Analyzes deal age, engagement, email opens, stage history & similar deals
        </p>
      </div>

      {/* Summary bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {[
          { label: "Avg AI Prob", value: `${Math.round(scores.reduce((s, sc) => s + sc.aiProbability, 0) / Math.max(1, scores.length))}%`, color: T.blue },
          { label: "High Conf", value: String(scores.filter(s => s.confidence === "high").length), color: T.green },
          { label: "At Risk", value: String(scores.filter(s => s.aiProbability < 40).length), color: T.red },
        ].map(m => (
          <div key={m.label} style={{
            flex: "1 1 100px", background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
            border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: "12px 14px", textAlign: "center",
          }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: m.color, fontFamily: "'JetBrains Mono', monospace" }}>{m.value}</div>
            <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{m.label}</div>
          </div>
        ))}
      </div>

      {scores.length === 0 && (
        <div style={{ textAlign: "center", padding: 40, color: T.text3 }}>No open deals to analyze</div>
      )}

      {scores.map(sc => {
        const probColor = sc.aiProbability >= 70 ? T.green : sc.aiProbability >= 45 ? T.accent : T.red;
        const diff = sc.aiProbability - sc.deal.probability;
        return (
          <div key={sc.deal.id} style={{
            background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
            border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "18px 20px",
            marginBottom: 12,
          }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>{sc.deal.title}</div>
                <div style={{ fontSize: 12, color: T.text3, marginTop: 2 }}>
                  {sc.deal.contact} · {fmt(sc.deal.value)} · {sc.deal.stage}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 28, fontWeight: 800, color: probColor, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1 }}>
                  {sc.aiProbability}%
                </div>
                <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                  Manual: {sc.deal.probability}%
                  {diff !== 0 && (
                    <span style={{ color: diff > 0 ? T.green : T.red, marginLeft: 4 }}>
                      ({diff > 0 ? "+" : ""}{diff})
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Probability bar */}
            <div style={{ height: 6, background: T.bg4, borderRadius: 3, marginBottom: 14, position: "relative" }}>
              <div style={{
                height: "100%", borderRadius: 3, width: `${sc.aiProbability}%`,
                background: `linear-gradient(90deg, ${probColor}88, ${probColor})`,
                transition: "width 0.5s ease",
              }} />
              {/* Manual marker */}
              <div style={{
                position: "absolute", top: -3, left: `${sc.deal.probability}%`, transform: "translateX(-50%)",
                width: 3, height: 12, background: T.text3, borderRadius: 2, opacity: 0.5,
              }} />
            </div>

            {/* Confidence badge */}
            <div style={{ display: "flex", gap: 6, marginBottom: 12, alignItems: "center" }}>
              <span style={{
                fontSize: 10, padding: "2px 8px", borderRadius: T.radius.sm,
                background: `${confColors[sc.confidence]}18`, color: confColors[sc.confidence],
                fontWeight: 600, border: `1px solid ${confColors[sc.confidence]}33`,
              }}>
                {confLabels[sc.confidence]}
              </span>
              <span style={{ fontSize: 11, color: T.text3, fontStyle: "italic" }}>{sc.recommendation}</span>
            </div>

            {/* Factors */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {sc.factors.slice(0, 5).map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                  <span style={{ width: 18, textAlign: "center" }}>{f.emoji}</span>
                  <span style={{ flex: 1, color: T.text2 }}>{f.label}</span>
                  <span style={{
                    fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", fontSize: 11,
                    color: f.impact >= 0 ? T.green : T.red,
                  }}>
                    {f.impact >= 0 ? "+" : ""}{f.impact}
                  </span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
