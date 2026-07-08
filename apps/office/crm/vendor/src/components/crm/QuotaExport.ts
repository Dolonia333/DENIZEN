import { T, S, fmt, type Quota, TEAM_MEMBERS } from "@/lib/crm-data";

const STATUS_LABELS: Record<string, string> = {
  "on-track": "On Track", "at-risk": "At Risk", "behind": "Behind", "achieved": "Achieved",
};

export function exportQuotasCsv(quotas: Quota[]) {
  const headers = ["Team Member", "Quota Type", "Period", "Target", "Stretch Goal", "Current", "Progress %", "Status", "Start Date", "End Date"];
  const rows = quotas.map(q => [
    q.assigneeName,
    q.type,
    q.period,
    q.type === "Revenue" ? q.targetValue : q.targetValue,
    q.stretchGoal || "",
    q.currentValue,
    `${Math.min(100, Math.round((q.currentValue / q.targetValue) * 100))}%`,
    STATUS_LABELS[q.status] || q.status,
    q.startDate,
    q.endDate,
  ].map(v => `"${v}"`).join(","));

  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `quota-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportQuotasPdf(quotas: Quota[]) {
  const win = window.open("", "_blank");
  if (!win) return;

  const rows = quotas.map(q => {
    const pct = Math.min(100, Math.round((q.currentValue / q.targetValue) * 100));
    const statusColor = q.status === "achieved" ? "#4d9ef7" : q.status === "on-track" ? "#22d3a0" : q.status === "at-risk" ? "#fbbf24" : "#f85b5b";
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${q.assigneeName}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${q.type}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">${q.period}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace">${q.type === "Revenue" ? "$" + q.targetValue.toLocaleString() : q.targetValue}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;font-family:monospace">${q.type === "Revenue" ? "$" + q.currentValue.toLocaleString() : q.currentValue}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:8px;background:#eee;border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${statusColor};border-radius:4px"></div>
          </div>
          <span style="font-weight:700;font-size:12px;color:${statusColor}">${pct}%</span>
        </div>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee">
        <span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;background:${statusColor}18;color:${statusColor}">${STATUS_LABELS[q.status] || q.status}</span>
      </td>
    </tr>`;
  }).join("");

  const achieved = quotas.filter(q => q.status === "achieved").length;
  const onTrack = quotas.filter(q => q.status === "on-track").length;
  const atRisk = quotas.filter(q => q.status === "at-risk").length;
  const behind = quotas.filter(q => q.status === "behind").length;

  win.document.write(`<!DOCTYPE html><html><head><title>Quota Report</title>
    <style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:40px;color:#1a1a2e}
    table{width:100%;border-collapse:collapse}th{text-align:left;padding:10px 12px;border-bottom:2px solid #333;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#666}
    .stats{display:flex;gap:24px;margin-bottom:32px}.stat{text-align:center}.stat-val{font-size:28px;font-weight:800}.stat-label{font-size:11px;color:#888;margin-top:4px}
    @media print{body{margin:20px}}</style></head><body>
    <h1 style="margin:0 0 4px">Quota Performance Report</h1>
    <p style="color:#888;margin:0 0 24px;font-size:13px">Generated ${new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" })}</p>
    <div class="stats">
      <div class="stat"><div class="stat-val">${quotas.length}</div><div class="stat-label">Total Quotas</div></div>
      <div class="stat"><div class="stat-val" style="color:#4d9ef7">${achieved}</div><div class="stat-label">Achieved</div></div>
      <div class="stat"><div class="stat-val" style="color:#22d3a0">${onTrack}</div><div class="stat-label">On Track</div></div>
      <div class="stat"><div class="stat-val" style="color:#fbbf24">${atRisk}</div><div class="stat-label">At Risk</div></div>
      <div class="stat"><div class="stat-val" style="color:#f85b5b">${behind}</div><div class="stat-label">Behind</div></div>
    </div>
    <table><thead><tr>
      <th>Team Member</th><th>Quota Type</th><th>Period</th><th>Target</th><th>Current</th><th>Progress</th><th>Status</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <script>setTimeout(()=>window.print(),500)</script></body></html>`);
  win.document.close();
}
