// ─── CRM DATA TYPES & SEED DATA ──────────────────────────────────────────────
export type ContactFrequency = "daily" | "weekly" | "bi-weekly" | "monthly" | "quarterly" | "as-needed";
export const CONTACT_FREQUENCIES: { value: ContactFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "bi-weekly", label: "Bi-Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "as-needed", label: "As Needed" },
];
export interface Contact {
  id: number; name: string; company: string; email: string; phone: string;
  status: string; tags: string[]; score: number; lastContact: string;
  interactions: number; leadSource?: string; avatar?: string;
  contactFrequency?: ContactFrequency;
  customFieldValues?: Record<string, any>;
}
export interface Deal {
  id: number; title: string; contact: string; value: number; stage: string;
  probability: number; closeDate: string; daysInStage: number; health: string;
  forecastCategory?: string; leadSource?: string; commissionRate?: number;
  customFieldValues?: Record<string, any>;
  ownerId?: string;
}
export interface Note { id: number; contact: string; text: string; date: string; type: string; }
export interface Subtask { id: number; title: string; done: boolean; }
export interface Task {
  id: number; title: string; contact: string; due: string; priority: string; done: boolean;
  description?: string;
  status?: "todo" | "in-progress" | "in-review" | "done";
  assignee?: string;
  assigneeAvatar?: string;
  createdBy?: string;
  projectTag?: string;
  projectColor?: string;
  isClientFacing?: boolean;
  subtasks?: Subtask[];
  createdAt?: string;
  statusHistory?: { status: string; at: string }[];
  comments?: { id: number; user: string; text: string; at: string }[];
}
export interface Goal { id: number; metric: string; label: string; target: number; current: number; period: string; color: string; icon: string; }
export interface Package {
  id: number; name: string; tier: string; tagline: string; color: string; icon: string;
  lineItems: { id: number; name: string; price: number; unit: string; included: boolean }[];
  features: string[]; addOns: { id: number; name: string; price: number; unit: string }[];
  bestFor: string[];
  setupFee?: number; minContract?: string;
}
export interface Submission {
  id: number; clientName: string; clientEmail: string; company: string;
  submittedAt: string; status: string; assignedTo: string; teamNote: string;
  answers: Record<string, any>; quoteId: number | null;
}
export interface Quote {
  id: number; submissionId: number; clientName: string; company: string;
  createdAt: string; status: string; recommendedPackage: string; aiReasoning: string;
  lineItems: { id: number; name: string; price: number; unit: string }[];
  monthlyTotal: number; onetimeTotal: number; notes: string; validUntil: string;
  portalToken: string; portalViewedAt: string | null; portalSignedAt: string | null;
  portalPaidAt: string | null; signature: string | null;
  portalSignatures?: { id: string; method: string; value: string; signerName: string; signerEmail?: string; signedAt: string; lockedAt: string }[];
  portalActivity: { type: string; at: string; note: string }[];
  customisations?: string[]; upsellNote?: string;
  discount?: { type: 'percent' | 'flat'; value: number; reason: string };
}
export interface Company {
  id: number; name: string; domain: string; industry: string; size: string;
  mrr: number; arr: number; health: string; tags: string[]; website: string;
  notes: string; linkedContacts: number[]; linkedDeals: number[];
  description?: string; buyingSignals?: string; techStack?: string[];
}
export interface Automation {
  id: number; name: string; active: boolean; trigger: string; triggerLabel: string;
  conditions: string; action: string; actionLabel: string; actionDetail: string;
  runCount: number; lastRun: string | null;
}
export interface AutomationRun {
  id: number; automationId: number; name: string; trigger: string; action: string;
  detail: string; at: string; dedupeKey?: string;
}
export interface DealComment {
  id: number; dealId: number; user: string; text: string; at: string;
}
export interface MetricSnapshot {
  date: string; contacts: number; openCount: number; wonCount: number; lostCount: number;
  pipelineValue: number; wonValue: number; overdueTasks: number; at: string;
}
export interface AiThreadMessage {
  role: string; text: string; source?: string; at: string; speaker?: string; authorEmail?: string;
}
export interface AiThread {
  id: number; title: string; messages: AiThreadMessage[]; updatedAt: string;
  ownerName?: string;
  ownerEmail?: string;
  npcKey?: string;
  npcName?: string;
}
export interface Meeting {
  id: number; title: string; type: string; date: string; time: string;
  duration: number; contact: string; attendees: string[]; status: string;
  notes: string; meetingUrl: string;
  externalId?: string;
  source?: string;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceParentId?: number;
  checklist?: string[];
}

export const MEETING_TEMPLATES = [
  { name: "Discovery Call", type: "discovery", duration: 30, notes: "", checklist: ["Confirm pain points", "Understand current solution", "Identify stakeholders", "Discuss budget range", "Agree on next steps"] },
  { name: "Product Demo", type: "demo", duration: 45, notes: "", checklist: ["Intro & agenda (2 min)", "Customer needs recap (3 min)", "Core feature walkthrough (20 min)", "Q&A (10 min)", "Pricing overview (5 min)", "Next steps & timeline (5 min)"] },
  { name: "Quarterly Review", type: "check-in", duration: 60, notes: "", checklist: ["Review KPIs & metrics", "Discuss wins & challenges", "Product roadmap preview", "Expansion opportunities", "Action items for next quarter", "Feedback collection"] },
];
export interface Sequence {
  id: number; name: string; active: boolean; enrolledCount: number; completedCount: number;
  steps: { id: number; type: string; day: number; subject?: string; title?: string; body?: string }[];
}
export interface SequenceEnrollment {
  id: number;
  sequenceId: number;
  contactId: number;
  enrolledAt: string;
  stepIndex: number;
  lastStepAt: string | null;
  completedAt?: string | null;
  status: "active" | "completed" | "paused";
}

export type TicketStatus = "open" | "pending" | "resolved" | "closed";
export type TicketPriority = "low" | "medium" | "high" | "urgent";

export interface TicketHistoryEntry {
  id: number; user: string; text: string; at: string;
  type: "comment" | "status" | "assign";
}

export interface SupportTicket {
  id: number;
  subject: string;
  contact: string;
  contactId?: number;
  status: TicketStatus;
  priority: TicketPriority;
  assignee?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  description: string;
  history: TicketHistoryEntry[];
  slaDue?: string;
  category?: string;
}

export type CampaignStatus = "draft" | "active" | "paused" | "completed";
export type CampaignType = "email" | "nurture" | "announcement";

export interface MarketingCampaign {
  id: number;
  name: string;
  status: CampaignStatus;
  type: CampaignType;
  segmentGroupIds: number[];
  sequenceId?: number;
  subject?: string;
  body?: string;
  sentCount: number;
  enrolledCount: number;
  qualifiedLeads: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  createdBy?: string;
}

export interface TeamPolicy {
  requiredDealFields: string[];
  requiredContactFields: string[];
  nudgeInactiveDays: number;
  requireOwnerOnDeal: boolean;
}

export interface UsageLogEntry {
  id: number;
  user: string;
  action: string;
  entity?: string;
  entityId?: number;
  at: string;
}

export const TICKET_STATUSES: TicketStatus[] = ["open", "pending", "resolved", "closed"];
export const TICKET_PRIORITIES: TicketPriority[] = ["low", "medium", "high", "urgent"];
export const TICKET_STATUS_META: Record<TicketStatus, { label: string; color: string }> = {
  open: { label: "Open", color: "#4d9ef7" },
  pending: { label: "Pending", color: "#f0b429" },
  resolved: { label: "Resolved", color: "#22d3a0" },
  closed: { label: "Closed", color: "#64748b" },
};
export const DEFAULT_TEAM_POLICY: TeamPolicy = {
  requiredDealFields: ["ownerId", "stage", "value"],
  requiredContactFields: ["email"],
  nudgeInactiveDays: 3,
  requireOwnerOnDeal: true,
};

export interface AuditEntry {
  id: number; user: string; action: string; entity: string; entityName: string;
  field?: string; from?: string; to?: string; at: string;
}
export interface EmailLogEntry {
  id: number; to: string; toEmail: string; contactId: number; subject: string;
  sentAt: string; opens: { at: string }[]; clicks: number; tracked: boolean;
  body?: string;
  status?: "sent" | "mailto";
  sentBy?: string;
}
export interface Commission {
  id: number; dealId: number; dealTitle: string; rep: string; value: number;
  rate: number; commission: number; paidAt: string | null; status: string;
}
export interface IntakeQuestion {
  id: number; label: string; type: string; required: boolean;
  options?: string[]; icon: string;
}

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────
export const T = {
  bg0:"#05080f",bg1:"#080d18",bg2:"#0d1422",bg3:"#121b2e",bg4:"#1c2640",bg5:"#1e2d4d",bg6:"#243358",
  /** Visible grid lines for calendar month/week/day views */
  gridLine:"rgba(148, 163, 184, 0.38)",
  gridLineStrong:"rgba(148, 163, 184, 0.55)",
  text0:"#ffffff",text1:"#e2eaf8",text2:"#7a92b8",text3:"#3d5278",
  accent:"#f0b429",accentHi:"#ffd166",accentDim:"#f0b42918",accentGlow:"0 0 20px #f0b42930",
  purple:"#8b5cf6",purpleDim:"#8b5cf618",
  blue:"#4d9ef7",blueDim:"#4d9ef718",
  green:"#22d3a0",greenDim:"#22d3a018",
  red:"#f85b5b",redDim:"#f85b5b18",
  orange:"#fb923c",
  radius:{xs:4,sm:6,md:10,lg:14,xl:20,full:999} as const,
  shadow:{
    card:"0 1px 3px rgba(0,0,0,0.4),0 8px 24px rgba(0,0,0,0.25)",
    elevated:"0 4px 16px rgba(0,0,0,0.5),0 1px 3px rgba(0,0,0,0.4)",
    glow:(color: string)=>`0 0 0 1px ${color}44,0 4px 20px ${color}22`,
  },
};

export const S: Record<string, any> = {
  input: { background:T.bg3, border:"1px solid "+T.bg4, borderRadius:T.radius.md, color:T.text1, padding:"9px 12px", width:"100%", fontSize:13, outline:"none", boxSizing:"border-box", transition:"border-color 0.15s" },
  card: { background:"linear-gradient(145deg,"+T.bg2+","+T.bg3+"88)", border:"1px solid "+T.bg4, borderRadius:T.radius.lg, padding:"20px 22px" },
  btn: { background:T.accent, color:"#080d18", border:"none", borderRadius:T.radius.md, padding:"8px 16px", fontWeight:700, fontSize:13, cursor:"pointer", letterSpacing:"0.01em" },
  btnGhost: { background:T.bg3, color:T.text2, border:"1px solid "+T.bg4, borderRadius:T.radius.md, padding:"8px 16px", fontSize:13, cursor:"pointer" },
  btnPurple: { background:"linear-gradient(135deg,#7c3aed,#6366f1)", color:"#fff", border:"none", borderRadius:T.radius.md, padding:"9px 18px", fontWeight:700, fontSize:13, cursor:"pointer" },
  btnGreen: { background:"linear-gradient(135deg,#059669,#10b981)", color:"#fff", border:"none", borderRadius:T.radius.md, padding:"9px 18px", fontWeight:700, fontSize:13, cursor:"pointer" },
  badge: (color: string, bg: string) => ({ fontSize:11, padding:"2px 8px", borderRadius:T.radius.sm, background:bg, color, fontWeight:600, letterSpacing:"0.02em" }),
  label: { fontSize:11, color:T.text2, display:"block", marginBottom:5, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.06em" },
  modalBg: { position:"fixed" as const, inset:0, background:"rgba(0,0,0,0.88)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, backdropFilter:"blur(4px)" },
  modalBox: { background:T.bg2, border:"1px solid "+T.bg4, borderRadius:T.radius.xl, padding:28, width:560, maxWidth:"94vw", maxHeight:"92vh", overflowY:"auto" },
  sectionLabel: { fontSize:10, color:T.text3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.1em", padding:"0 12px", marginBottom:4, marginTop:16 },
};

export const fmt = (n: number) => "$" + Number(n).toLocaleString();
export const badgeStyle = (color: string, bg: string) => S.badge(color, bg);
export const STAGES = ["Lead","Qualified","Proposal","Negotiation","Closed Won","Closed Lost"];
export const STAGE_COLORS: Record<string,string> = { Lead:"#6366f1", Qualified:"#f0b429", Proposal:"#3b82f6", Negotiation:"#8b5cf6", "Closed Won":"#10b981", "Closed Lost":"#ef4444" };
export const CHECKLIST_ITEMS = [
  { id:"profile", label:"Set up your profile", tab:null as string|null },
  { id:"team", label:"Invite team members", tab:"onboarding" },
  { id:"packages", label:"Build your packages", tab:"packages" },
  { id:"intake", label:"Send your first intake form", tab:"intake" },
  { id:"contact", label:"Add your first contact", tab:"contacts" },
  { id:"deal", label:"Create your first deal", tab:"pipeline" },
  { id:"ai", label:"Try the AI Assistant", tab:"ai" },
];
export const ROLES = [
  { id:"sales", label:"Sales Rep", icon:"💼", desc:"Manage leads, deals & pipeline" },
  { id:"manager", label:"Sales Manager", icon:"📊", desc:"Oversee team performance & forecasts" },
  { id:"support", label:"Support Agent", icon:"🎧", desc:"Handle tickets & customer issues" },
  { id:"account", label:"Account Manager", icon:"🤝", desc:"Manage existing customers & renewals" },
];
export const FORECAST_CATEGORIES: Record<string,{color:string}> = { Commit:{color:"#22d3a0"}, "Best Case":{color:"#4d9ef7"}, Pipeline:{color:"#f0b429"}, Omitted:{color:"#3d5278"} };
export const LEAD_SOURCES = ["Organic Search","Paid Ads","Referral","Cold Outreach","Event","Partner","Social Media","Other"];
export const AUTO_TRIGGERS = [
  {id:"deal_created",label:"Deal Created"},{id:"deal_moved",label:"Deal Stage Changed"},
  {id:"deal_won",label:"Deal Won"},{id:"deal_lost",label:"Deal Lost"},
  {id:"deal_stale",label:"Deal Goes Stale (14+ days)"},{id:"task_overdue",label:"Task Overdue"},
  {id:"contact_added",label:"Contact Added"},
  {id:"quote_sent",label:"Quote Sent"},{id:"form_submitted",label:"Form Submitted"},
  {id:"ticket_created",label:"Support Ticket Created"},{id:"ticket_overdue",label:"Ticket SLA Breach"},
  {id:"campaign_started",label:"Campaign Started"},{id:"campaign_completed",label:"Campaign Completed"},
];
export const AUTO_ACTIONS = [
  {id:"create_task",label:"Create Task"},{id:"notify",label:"Send Notification"},
  {id:"draft_email",label:"Draft AI Email"},{id:"update_field",label:"Update Field"},
  {id:"webhook",label:"POST Webhook (n8n)"},
];
export const INDUSTRIES = ["Technology","SaaS","E-commerce","Healthcare","Finance","Media","Education","Manufacturing","Consulting","Other"];
export const SLA_DEFAULTS: Record<string,number> = { Lead:2, Qualified:5, Proposal:7, Negotiation:14 };
export const INTAKE_STATUSES = ["new","reviewing","quoted","sent","won","lost"];
export const STATUS_META: Record<string,{label:string;color:string;bg:string;dot:string}> = {
  new:{label:"New",color:"#fbbf24",bg:"#451a03",dot:"#fbbf24"},
  reviewing:{label:"Reviewing",color:"#a78bfa",bg:"#2d1f5e",dot:"#a78bfa"},
  quoted:{label:"Quoted",color:"#60a5fa",bg:"#1e3a5f",dot:"#60a5fa"},
  sent:{label:"Sent",color:"#6ee7b7",bg:"#064e3b",dot:"#10b981"},
  won:{label:"Won 🎉",color:"#6ee7b7",bg:"#064e3b",dot:"#10b981"},
  lost:{label:"Lost",color:"#f87171",bg:"#7f1d1d",dot:"#ef4444"},
};
export const PRIORITY_META: Record<string,[string,string,string]> = {
  hot:["🔥 Hot","#ef4444","#3d0a0a"], warm:["⚡ Warm","#f0b429","#3d2200"], cool:["💙 Cool","#60a5fa","#0f2a4a"]
};
export const WIN_REASONS = ["Better fit","Pricing","Relationship","Features","Speed","Other"];
export const LOSS_REASONS = ["Price too high","Went competitor","No budget","Bad timing","Ghosted","Other"];

export function getLeadPriority(sub: Submission): string {
  const budget = sub.answers?.["What's your expected monthly budget?"] || "";
  const timing = sub.answers?.["How soon are you looking to get started?"] || "";
  let score = 0;
  if (budget.includes("$2,500")) score += 3;
  else if (budget.includes("$800")) score += 2;
  else if (budget.includes("$300")) score += 1;
  if (timing.includes("Right away")) score += 2;
  else if (timing.includes("30 days")) score += 1;
  return score >= 4 ? "hot" : score >= 2 ? "warm" : "cool";
}

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com", "protonmail.com", "live.com",
]);

function hasCorporateEmailDomain(email: string): boolean {
  const domain = email.split("@")[1]?.toLowerCase().trim();
  return !!domain && !CONSUMER_EMAIL_DOMAINS.has(domain);
}

function isReferralContact(contact: Contact): boolean {
  const source = (contact.leadSource || "").toLowerCase();
  if (source.includes("referral")) return true;
  if (contact.tags?.some((t) => t.toLowerCase() === "referral")) return true;
  const cf = contact.customFieldValues?.referral_source;
  return typeof cf === "string" && cf.trim().length > 0;
}

function hasRecentActivityTask(contact: Contact, tasks: Task[]): boolean {
  const cutoff = Date.now() - 5 * 86400000;
  return (tasks || []).some((t) => {
    if (t.contact !== contact.name) return false;
    const ref = t.createdAt || t.due;
    return new Date(ref).getTime() >= cutoff;
  });
}

export function calcLeadScore(
  contact: Contact,
  emailLog: EmailLogEntry[],
  deals: Deal[],
  notes: Note[],
  tasks: Task[] = [],
): number {
  let score = 40;
  if (contact.status === "Customer") score += 30;
  else if (contact.status === "Prospect") score += 15;
  const myEmails = (emailLog || []).filter(e => e.contactId === contact.id || e.to === contact.name);
  const opens = myEmails.reduce((s, e) => s + (e.opens?.length || 0), 0);
  score += Math.min(opens * 5, 20);
  const myDeals = (deals || []).filter(d => d.contact === contact.name && d.stage !== "Closed Lost");
  if (myDeals.length > 0) score += 15;
  if (myDeals.some(d => ["Proposal","Negotiation"].includes(d.stage))) score += 10;
  const days = Math.floor((Date.now() - new Date(contact.lastContact).getTime()) / 86400000);
  if (days < 7) score += 10; else if (days > 60) score -= 15;
  score += Math.min(((notes || []).filter(n => n.contact === contact.name).length) * 2, 10);
  if (contact.tags?.includes("Enterprise") || contact.tags?.includes("High Value")) score += 10;
  if (hasCorporateEmailDomain(contact.email)) score += 20;
  if (hasRecentActivityTask(contact, tasks)) score += 35;
  if (isReferralContact(contact)) score += 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function csvCell(v: unknown): string {
  return `"${String(v ?? "").replace(/"/g, '""')}"`;
}

export function contactsToCsv(contacts: Contact[], customFieldIds?: string[]): string {
  const cfIds = customFieldIds || [...new Set(contacts.flatMap((c) => Object.keys(c.customFieldValues || {})))];
  const headers = ["Name", "Company", "Email", "Phone", "Status", "Tags", "Score", "Last Contact", ...cfIds];
  const rows = contacts.map((c) => [
    c.name, c.company, c.email, c.phone, c.status, (c.tags || []).join(";"), c.score, c.lastContact,
    ...cfIds.map((id) => c.customFieldValues?.[id] ?? ""),
  ].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export { parseCsv, parseCsvContacts, parseCsvDeals, parseCsvTasks, parseCsvCompanies, parseCsvNotes, parseCsvAuto, detectCsvKind } from "@/lib/crm-csv";
export type { CsvImportKind, CsvAutoResult } from "@/lib/crm-csv";

// ─── SEED DATA ───────────────────────────────────────────────────────────────
export const initialEmailLog: EmailLogEntry[] = [
  {id:1,to:"Sarah Chen",toEmail:"sarah@acme.com",contactId:1,subject:"Following up",sentAt:"2026-03-17T10:00:00",opens:[{at:"2026-03-17T10:42:00"},{at:"2026-03-17T14:20:00"}],clicks:1,tracked:true},
  {id:2,to:"Marcus Rivera",toEmail:"m.rivera@brightlabs.io",contactId:2,subject:"Your proposal",sentAt:"2026-03-18T09:00:00",opens:[{at:"2026-03-18T09:31:00"}],clicks:0,tracked:true},
  {id:3,to:"Priya Nair",toEmail:"priya@nexus.com",contactId:3,subject:"Quick check-in",sentAt:"2026-03-15T14:00:00",opens:[],clicks:0,tracked:true},
];
export const initialContacts: Contact[] = [
  {id:1,name:"Sarah Chen",company:"Acme Corp",email:"sarah@acme.com",phone:"555-0101",status:"Customer",tags:["Enterprise"],score:92,lastContact:"2026-03-07",interactions:14},
  {id:2,name:"Marcus Rivera",company:"Bright Labs",email:"m.rivera@brightlabs.io",phone:"555-0182",status:"Lead",tags:["SMB"],score:67,lastContact:"2026-03-06",interactions:5},
  {id:3,name:"Priya Nair",company:"Nexus Systems",email:"priya@nexus.com",phone:"555-0234",status:"Prospect",tags:["Enterprise","Warm"],score:81,lastContact:"2026-03-05",interactions:9},
  {id:4,name:"Tom Blake",company:"Orbit Media",email:"tom@orbitco.com",phone:"555-0312",status:"Lead",tags:["Cold"],score:34,lastContact:"2026-02-12",interactions:2},
];
export const initialDeals: Deal[] = [
  {id:1,title:"Acme Annual Contract",contact:"Sarah Chen",value:48000,stage:"Negotiation",probability:80,closeDate:"2026-04-15",daysInStage:12,health:"good",ownerId:"john"},
  {id:2,title:"Bright Labs Pilot",contact:"Marcus Rivera",value:12000,stage:"Proposal",probability:50,closeDate:"2026-05-01",daysInStage:6,health:"good",ownerId:"sarah"},
  {id:3,title:"Nexus Integration",contact:"Priya Nair",value:75000,stage:"Qualified",probability:30,closeDate:"2026-06-30",daysInStage:21,health:"at-risk",ownerId:"marcus"},
  {id:4,title:"Starter Renewal",contact:"Sarah Chen",value:9600,stage:"Closed Won",probability:100,closeDate:"2026-03-20",daysInStage:1,health:"good",ownerId:"john"},
  {id:5,title:"Cloud Migration",contact:"Tom Blake",value:28000,stage:"Closed Won",probability:100,closeDate:"2026-03-15",daysInStage:3,health:"good",ownerId:"sarah"},
  {id:6,title:"Data Analytics Suite",contact:"Marcus Rivera",value:18500,stage:"Closed Won",probability:100,closeDate:"2026-03-22",daysInStage:2,health:"good",ownerId:"john"},
];
export const initialNotes: Note[] = [
  {id:1,contact:"Sarah Chen",text:"Discussed renewal terms — wants 15% discount for 2-year deal.",date:"2026-03-07",type:"Call"},
  {id:2,contact:"Marcus Rivera",text:"Sent proposal deck. Follow up in 3 days.",date:"2026-03-06",type:"Email"},
  {id:3,contact:"Priya Nair",text:"First discovery call — clear pain points around integrations.",date:"2026-03-05",type:"Meeting"},
];
export const initialTasks: Task[] = [
  {id:1,title:"Follow up with Marcus on proposal",description:"Send the updated pricing deck and schedule a call to walk through the changes.",contact:"Marcus Rivera",due:"2026-03-10",priority:"High",done:false,status:"todo",assignee:"John Doe",createdBy:"John Doe",projectTag:"Sales",projectColor:"#f0b429",isClientFacing:false,subtasks:[{id:1,title:"Update pricing deck",done:true},{id:2,title:"Send email with deck",done:false},{id:3,title:"Schedule follow-up call",done:false}],createdAt:"2026-03-06",statusHistory:[{status:"todo",at:"2026-03-06"}]},
  {id:2,title:"Send contract draft to Sarah",description:"Prepare the annual contract with the 15% discount for 2-year commitment.",contact:"Sarah Chen",due:"2026-03-12",priority:"High",done:false,status:"in-progress",assignee:"John Doe",createdBy:"John Doe",projectTag:"Legal",projectColor:"#8b5cf6",isClientFacing:true,subtasks:[{id:1,title:"Draft contract terms",done:true},{id:2,title:"Add discount clause",done:true},{id:3,title:"Legal review",done:false},{id:4,title:"Send to Sarah",done:false}],createdAt:"2026-03-07",statusHistory:[{status:"todo",at:"2026-03-07"},{status:"in-progress",at:"2026-03-09"}]},
  {id:3,title:"Schedule demo with Priya",description:"Set up a product demo focusing on pipeline features and integrations.",contact:"Priya Nair",due:"2026-03-15",priority:"Medium",done:true,status:"done",assignee:"Jane Smith",createdBy:"John Doe",projectTag:"Sales",projectColor:"#f0b429",isClientFacing:true,subtasks:[{id:1,title:"Prepare demo environment",done:true},{id:2,title:"Send calendar invite",done:true}],createdAt:"2026-03-05",statusHistory:[{status:"todo",at:"2026-03-05"},{status:"in-progress",at:"2026-03-08"},{status:"done",at:"2026-03-10"}]},
  {id:4,title:"Update CRM onboarding docs",description:"Revise the getting started guide with the new features from Q1.",contact:"",due:"2026-03-18",priority:"Low",done:false,status:"in-review",assignee:"Jane Smith",createdBy:"Jane Smith",projectTag:"Internal",projectColor:"#4d9ef7",isClientFacing:false,subtasks:[{id:1,title:"Screenshot new features",done:true},{id:2,title:"Write updated steps",done:true},{id:3,title:"Peer review",done:false}],createdAt:"2026-03-10",statusHistory:[{status:"todo",at:"2026-03-10"},{status:"in-progress",at:"2026-03-12"},{status:"in-review",at:"2026-03-16"}]},
  {id:5,title:"Prepare QBR deck for Acme",description:"Quarterly business review presentation for Acme Corp covering Q1 metrics.",contact:"Sarah Chen",due:"2026-03-25",priority:"Medium",done:false,status:"todo",assignee:"John Doe",createdBy:"John Doe",projectTag:"Account Mgmt",projectColor:"#22d3a0",isClientFacing:true,subtasks:[{id:1,title:"Pull Q1 metrics",done:false},{id:2,title:"Create slide deck",done:false},{id:3,title:"Review with manager",done:false}],createdAt:"2026-03-14",statusHistory:[{status:"todo",at:"2026-03-14"}]},
];
export const initialGoals: Goal[] = [
  {id:1,metric:"mrr",label:"MRR Goal",target:15000,current:4998,period:"Q1 2026",color:"#f0b429",icon:"💰"},
  {id:2,metric:"deals_won",label:"Deals Won",target:8,current:1,period:"Q1 2026",color:"#22d3a0",icon:"🏆"},
  {id:3,metric:"new_contacts",label:"New Contacts",target:30,current:4,period:"Q1 2026",color:"#4d9ef7",icon:"👥"},
  {id:4,metric:"pipeline_value",label:"Pipeline Value",target:200000,current:135000,period:"Q1 2026",color:"#8b5cf6",icon:"📈"},
];
export const initialPackages: Package[] = [
  {id:1,name:"Starter",tier:"starter",tagline:"Perfect for small teams",color:"#6366f1",icon:"🚀",lineItems:[{id:1,name:"Platform Access (5 users)",price:299,unit:"/mo",included:true},{id:2,name:"Basic Analytics",price:0,unit:"",included:true},{id:3,name:"Email Support",price:0,unit:"",included:true},{id:4,name:"Onboarding Call",price:150,unit:"one-time",included:true}],features:["5 users","10GB storage","Email support","Standard reports"],addOns:[{id:1,name:"Extra User Seat",price:25,unit:"/mo"},{id:2,name:"Priority Support",price:49,unit:"/mo"}],bestFor:["1-10 employees","Early stage","Budget conscious"]},
  {id:2,name:"Professional",tier:"pro",tagline:"For growing teams that need more power",color:"#f0b429",icon:"⚡",lineItems:[{id:1,name:"Platform Access (25 users)",price:799,unit:"/mo",included:true},{id:2,name:"Advanced Analytics",price:0,unit:"",included:true},{id:3,name:"Priority Support",price:0,unit:"",included:true},{id:4,name:"Onboarding (3 sessions)",price:350,unit:"one-time",included:true},{id:5,name:"API Access",price:0,unit:"",included:true}],features:["25 users","100GB storage","Priority support","AI features","API access","Custom reports"],addOns:[{id:1,name:"Extra User Seat",price:20,unit:"/mo"},{id:2,name:"Dedicated CSM",price:199,unit:"/mo"},{id:3,name:"Custom Integrations",price:499,unit:"one-time"}],bestFor:["10-50 employees","Growing revenue","Needs integrations"]},
  {id:3,name:"Enterprise",tier:"enterprise",tagline:"Unlimited scale with white-glove service",color:"#10b981",icon:"🏢",lineItems:[{id:1,name:"Platform Access (unlimited)",price:2499,unit:"/mo",included:true},{id:2,name:"Full Analytics Suite",price:0,unit:"",included:true},{id:3,name:"24/7 Dedicated Support",price:0,unit:"",included:true},{id:4,name:"Full Onboarding Program",price:0,unit:"",included:true},{id:5,name:"Custom Integrations + SSO",price:0,unit:"",included:true},{id:6,name:"Quarterly Business Reviews",price:0,unit:"",included:true}],features:["Unlimited users","Unlimited storage","24/7 support","SLA guarantee","SSO","Custom contracts","Dedicated CSM"],addOns:[{id:1,name:"Custom Development",price:1500,unit:"/mo"},{id:2,name:"On-Site Training",price:2500,unit:"one-time"}],bestFor:["50+ employees","Enterprise deals","Complex requirements"]},
];
export const initialCompanies: Company[] = [
  {id:1,name:"Acme Corp",domain:"acme.com",industry:"Technology",size:"51-200",mrr:4000,arr:48000,health:"good",tags:["Enterprise"],website:"https://acme.com",notes:"Long-term customer.",linkedContacts:[1],linkedDeals:[1,4]},
  {id:2,name:"Bright Labs",domain:"brightlabs.io",industry:"SaaS",size:"11-50",mrr:0,arr:0,health:"warm",tags:["SMB"],website:"https://brightlabs.io",notes:"Pilot in progress.",linkedContacts:[2],linkedDeals:[2]},
  {id:3,name:"Nexus Systems",domain:"nexus.com",industry:"Enterprise Software",size:"51-200",mrr:998,arr:11976,health:"at-risk",tags:["Enterprise","Hot"],website:"https://nexus.com",notes:"Salesforce migration concern.",linkedContacts:[3],linkedDeals:[3]},
  {id:4,name:"Orbit Media",domain:"orbitco.com",industry:"Media",size:"1-10",mrr:0,arr:0,health:"cold",tags:["Cold"],website:"https://orbitco.com",notes:"Gone dark.",linkedContacts:[4],linkedDeals:[]},
];
export const initialAutomations: Automation[] = [
  {id:1,name:"New Lead → Welcome Task",active:true,trigger:"deal_created",triggerLabel:"Deal Created",conditions:"stage = Lead",action:"create_task",actionLabel:"Create Task",actionDetail:"Follow up within 48 hours",runCount:12,lastRun:"2026-03-18"},
  {id:2,name:"Stale Deal Alert",active:true,trigger:"deal_stale",triggerLabel:"Deal Goes Stale",conditions:"14+ days in stage",action:"notify",actionLabel:"Send Notification",actionDetail:"Alert team",runCount:3,lastRun:"2026-03-15"},
  {id:3,name:"Won Deal → Commission",active:false,trigger:"deal_won",triggerLabel:"Deal Won",conditions:"",action:"notify",actionLabel:"Send Notification",actionDetail:"Calculate commission",runCount:0,lastRun:null},
];
export const initialSubmissions: Submission[] = [
  {id:1,clientName:"Priya Nair",clientEmail:"priya@nexus.com",company:"Nexus Systems",submittedAt:"2026-03-06",status:"quoted",assignedTo:"",teamNote:"",answers:{"How many people are on your team?":"51–200","What is your annual revenue range?":"$10M–$50M","What are your top goals with our platform?":["Automate workflows","Better reporting & analytics","Team collaboration"],"What's your biggest current challenge?":"Sales team has zero pipeline visibility.","What's your expected monthly budget?":"$800–$2,500/mo","How soon are you looking to get started?":"Within 30 days","Any specific integrations or requirements?":"Salesforce migration, Slack, Okta SSO"},quoteId:1},
  {id:2,clientName:"Raj Patel",clientEmail:"raj@cloudforge.io",company:"CloudForge",submittedAt:"2026-03-09",status:"new",assignedTo:"",teamNote:"",answers:{"How many people are on your team?":"11–50","What is your annual revenue range?":"$2M–$10M","What are your top goals with our platform?":["Increase sales revenue","Automate workflows"],"What's your biggest current challenge?":"No consistent sales process.","What's your expected monthly budget?":"$300–$800/mo","How soon are you looking to get started?":"Right away","Any specific integrations or requirements?":"HubSpot migration, Zapier"},quoteId:null},
];
export const initialQuotes: Quote[] = [
  {id:1,submissionId:1,clientName:"Priya Nair",company:"Nexus Systems",createdAt:"2026-03-06",status:"sent",recommendedPackage:"Professional",aiReasoning:"Nexus fits Professional. Budget of $800–$2,500/mo works.",lineItems:[{id:1,name:"Professional Plan",price:799,unit:"/mo"},{id:2,name:"Onboarding (3 sessions)",price:350,unit:"one-time"},{id:3,name:"Custom Integrations",price:499,unit:"one-time"},{id:4,name:"Dedicated CSM",price:199,unit:"/mo"}],monthlyTotal:998,onetimeTotal:849,notes:"Strong fit for Professional.",validUntil:"2026-04-06",portalToken:"tok_priya_001",portalViewedAt:"2026-03-07T14:22:00",portalSignedAt:null,portalPaidAt:null,signature:null,portalActivity:[{type:"sent",at:"2026-03-06T16:00:00",note:"Portal link sent"},{type:"viewed",at:"2026-03-07T14:22:00",note:"Client opened portal"}]},
];
export const initialMeetings: Meeting[] = [
  {id:1,title:"Discovery Call — Acme Corp",type:"discovery",date:"2026-03-20",time:"10:00",duration:30,contact:"Sarah Chen",attendees:["Sarah Chen"],status:"confirmed",notes:"Discuss enterprise plan",meetingUrl:"https://meet.google.com/abc"},
  {id:2,title:"Product Demo — Bright Labs",type:"demo",date:"2026-03-21",time:"14:00",duration:45,contact:"Marcus Rivera",attendees:["Marcus Rivera"],status:"confirmed",notes:"Focus on pipeline features",meetingUrl:"https://zoom.us/j/123"},
  {id:3,title:"Proposal Review — Nexus",type:"proposal",date:"2026-03-24",time:"11:00",duration:60,contact:"Priya Nair",attendees:["Priya Nair"],status:"confirmed",notes:"Walk through pricing",meetingUrl:""},
];
export const initialSequences: Sequence[] = [
  {id:1,name:"New Lead Welcome",active:true,enrolledCount:8,completedCount:3,steps:[{id:1,type:"email",day:0,subject:"Welcome to Meridian"},{id:2,type:"delay",day:2,title:"Wait 2 days"},{id:3,type:"email",day:2,subject:"Here's what you can do"},{id:4,type:"task",day:4,title:"Call to check in"},{id:5,type:"email",day:7,subject:"How can we help?"}]},
  {id:2,name:"Post-Demo Follow-Up",active:true,enrolledCount:4,completedCount:2,steps:[{id:1,type:"email",day:0,subject:"Thanks for the demo!"},{id:2,type:"delay",day:1,title:"Wait 1 day"},{id:3,type:"task",day:1,title:"Send proposal"},{id:4,type:"email",day:3,subject:"Checking in on the proposal"}]},
];
export const initialAuditLog: AuditEntry[] = [
  {id:1,user:"You",action:"created",entity:"deal",entityName:"Acme Annual Contract",at:"2026-03-18T10:00:00"},
  {id:2,user:"You",action:"updated",entity:"contact",entityName:"Sarah Chen",field:"status",from:"Prospect",to:"Customer",at:"2026-03-17T14:00:00"},
  {id:3,user:"You",action:"sent",entity:"quote",entityName:"Nexus Systems Quote",at:"2026-03-06T16:00:00"},
];
export const defaultIntakeQuestions: IntakeQuestion[] = [
  {id:1,label:"How many people are on your team?",type:"select",required:true,options:["Just me","2–10","11–50","51–200","200+"],icon:"👥"},
  {id:2,label:"What is your annual revenue range?",type:"select",required:true,options:["Under $500K","$500K–$2M","$2M–$10M","$10M–$50M","$50M+"],icon:"💰"},
  {id:3,label:"What are your top goals with our platform?",type:"multiselect",required:true,options:["Increase sales revenue","Improve customer retention","Automate workflows","Better reporting & analytics","Team collaboration","Customer support management"],icon:"🎯"},
  {id:4,label:"What's your biggest current challenge?",type:"textarea",required:true,icon:"🔧"},
  {id:5,label:"What's your expected monthly budget?",type:"select",required:true,options:["Under $300/mo","$300–$800/mo","$800–$2,500/mo","$2,500+/mo","Not sure yet"],icon:"💳"},
  {id:6,label:"How soon are you looking to get started?",type:"select",required:false,options:["Right away","Within 30 days","1–3 months","Just exploring"],icon:"⏱"},
  {id:7,label:"Any specific integrations or requirements?",type:"textarea",required:false,icon:"🔌"},
];
export const initialAvailability = {
  timezone:"America/Chicago",workdays:[1,2,3,4,5],startHour:9,endHour:17,bufferTime:15,
  meetingTypes:[{id:1,name:"Discovery Call",duration:30,description:"Learn about your goals",color:"#4d9ef7"},{id:2,name:"Product Demo",duration:45,description:"See the platform in action",color:"#f0b429"},{id:3,name:"Strategy Session",duration:60,description:"Deep dive into your workflow",color:"#8b5cf6"},{id:4,name:"Quick Check-in",duration:15,description:"Fast 15-min sync",color:"#22d3a0"}],
};
export const initialBranding = {companyName:"Meridian",tagline:"Pro Workspace",logoEmoji:"M",logoGradient:"linear-gradient(135deg,#e2a71e,#d97706)",accentColor:"#f0b429"};
export const initialCommissions: Commission[] = [];
export const initialProducts = [{id:1,name:"CRM Platform",sku:"CRM-001",price:799,unit:"/mo",category:"Software",description:"Core CRM platform access",active:true},{id:2,name:"Onboarding Package",sku:"OB-001",price:350,unit:"one-time",category:"Services",description:"3-session onboarding",active:true}];
export const initialEmailTemplates = [{id:1,name:"Welcome Email",subject:"Welcome to {{company}}!",body:"Hi {{name}},\n\nWelcome aboard!",category:"Onboarding"},{id:2,name:"Follow-Up",subject:"Following up on our conversation",body:"Hi {{name}},\n\nJust wanted to check in.",category:"Sales"}];
export const initialCustomFields: Record<string,any[]> = {contacts:[],deals:[]};
export const initialWebhooks: any[] = [];
export const initialViews = [{id:1,name:"High-Value Leads",entity:"contacts",filters:{minScore:70,status:"Lead"}},{id:2,name:"At-Risk Deals",entity:"deals",filters:{health:"at-risk"}}];
export const initialPipelines = [{id:1,name:"Sales Pipeline",stages:STAGES,isDefault:true},{id:2,name:"Partnership Pipeline",stages:["Intro","Evaluation","Terms","Active","Churned"],isDefault:false}];

export interface ToastItem { id: number; message: string; type: string; title: string; }

// ─── QUOTA MANAGEMENT ────────────────────────────────────────────────────────
export type QuotaPeriod = "weekly" | "monthly" | "quarterly" | "annual";
export type QuotaStatus = "on-track" | "at-risk" | "behind" | "achieved";
export interface Quota {
  id: number;
  assigneeId: string;
  assigneeName: string;
  type: string;
  period: QuotaPeriod;
  targetValue: number;
  stretchGoal?: number;
  currentValue: number;
  startDate: string;
  endDate: string;
  createdBy: string;
  status: QuotaStatus;
}

export type QuotaProposalStatus = "pending" | "accepted" | "counter" | "rejected";
export interface QuotaProposal {
  id: number;
  quotaId?: number;
  assigneeId: string;
  assigneeName: string;
  type: string;
  period: QuotaPeriod;
  targetValue: number;
  stretchGoal?: number;
  proposedBy: string;
  proposedAt: string;
  proposalStatus: QuotaProposalStatus;
  counterValue?: number;
  counterNote?: string;
  managerNote?: string;
}

export interface ReportSchedule {
  id: number;
  frequency: "weekly" | "monthly";
  dayOfWeek?: number; // 0-6 for weekly
  dayOfMonth?: number; // 1-28 for monthly
  recipientIds: string[];
  enabled: boolean;
  lastSent?: string;
  createdAt: string;
}

export const DEFAULT_QUOTA_TYPES = ["Revenue", "Deals Closed", "Calls Made", "Meetings Booked"];

export interface QuotaTemplate {
  id: number;
  name: string;
  type: string;
  period: QuotaPeriod;
  targetValue: number;
  stretchGoal?: number;
  isBuiltIn: boolean;
}

export const BUILT_IN_QUOTA_TEMPLATES: QuotaTemplate[] = [
  { id: 1, name: "Monthly Revenue Standard", type: "Revenue", period: "monthly", targetValue: 50000, stretchGoal: 65000, isBuiltIn: true },
  { id: 2, name: "Quarterly Revenue Target", type: "Revenue", period: "quarterly", targetValue: 150000, stretchGoal: 180000, isBuiltIn: true },
  { id: 3, name: "Monthly Deal Closer", type: "Deals Closed", period: "monthly", targetValue: 8, stretchGoal: 12, isBuiltIn: true },
  { id: 4, name: "Weekly Call Blitz", type: "Calls Made", period: "weekly", targetValue: 50, isBuiltIn: true },
  { id: 5, name: "Monthly Meeting Machine", type: "Meetings Booked", period: "monthly", targetValue: 20, stretchGoal: 30, isBuiltIn: true },
  { id: 6, name: "Annual Revenue Goal", type: "Revenue", period: "annual", targetValue: 600000, stretchGoal: 750000, isBuiltIn: true },
];

export const TEAM_MEMBERS = [
  { id: "john", name: "John Doe", avatar: "JD", role: "sales" },
  { id: "sarah", name: "Sarah Kim", avatar: "SK", role: "sales" },
  { id: "marcus", name: "Marcus Rivera", avatar: "MR", role: "sales" },
  { id: "anya", name: "Anya Patel", avatar: "AP", role: "sales" },
  { id: "james", name: "James Lee", avatar: "JL", role: "manager" },
];

export function calcQuotaStatus(quota: Quota): QuotaStatus {
  if (quota.currentValue >= quota.targetValue) return "achieved";
  const now = Date.now();
  const start = new Date(quota.startDate).getTime();
  const end = new Date(quota.endDate).getTime();
  const totalDuration = end - start;
  if (totalDuration <= 0) return "behind";
  const elapsed = Math.min(now - start, totalDuration);
  const timeProgress = elapsed / totalDuration;
  const valueProgress = quota.currentValue / quota.targetValue;
  if (valueProgress >= timeProgress * 0.9) return "on-track";
  if (valueProgress >= timeProgress * 0.6) return "at-risk";
  return "behind";
}

export function getQuotaDaysRemaining(quota: Quota): number {
  const end = new Date(quota.endDate).getTime();
  const now = Date.now();
  return Math.max(0, Math.ceil((end - now) / 86400000));
}

function periodDates(period: QuotaPeriod): { startDate: string; endDate: string } {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth();
  switch (period) {
    case "weekly": {
      const d = now.getDay();
      const s = new Date(now); s.setDate(now.getDate() - d);
      const e = new Date(s); e.setDate(s.getDate() + 6);
      return { startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10) };
    }
    case "monthly": return { startDate: `${y}-${String(m + 1).padStart(2, "0")}-01`, endDate: new Date(y, m + 1, 0).toISOString().slice(0, 10) };
    case "quarterly": {
      const q = Math.floor(m / 3);
      return { startDate: new Date(y, q * 3, 1).toISOString().slice(0, 10), endDate: new Date(y, q * 3 + 3, 0).toISOString().slice(0, 10) };
    }
    case "annual": return { startDate: `${y}-01-01`, endDate: `${y}-12-31` };
  }
}

export const initialQuotas: Quota[] = [
  { id: 1, assigneeId: "john", assigneeName: "John Doe", type: "Revenue", period: "monthly", targetValue: 50000, stretchGoal: 65000, currentValue: 36000, ...periodDates("monthly"), createdBy: "james", status: "on-track" },
  { id: 2, assigneeId: "sarah", assigneeName: "Sarah Kim", type: "Revenue", period: "monthly", targetValue: 45000, stretchGoal: 55000, currentValue: 18000, ...periodDates("monthly"), createdBy: "james", status: "at-risk" },
  { id: 3, assigneeId: "marcus", assigneeName: "Marcus Rivera", type: "Deals Closed", period: "monthly", targetValue: 8, currentValue: 9, ...periodDates("monthly"), createdBy: "james", status: "achieved" },
  { id: 4, assigneeId: "anya", assigneeName: "Anya Patel", type: "Meetings Booked", period: "weekly", targetValue: 12, currentValue: 4, ...periodDates("weekly"), createdBy: "james", status: "behind" },
  { id: 5, assigneeId: "john", assigneeName: "John Doe", type: "Calls Made", period: "weekly", targetValue: 30, currentValue: 22, ...periodDates("weekly"), createdBy: "james", status: "on-track" },
];

export { periodDates as getQuotaPeriodDates };

export function computeQuotaValueFromDeals(quota: Quota, deals: Deal[]): number {
  const start = new Date(quota.startDate).getTime();
  const end = new Date(quota.endDate).getTime();
  const closedDeals = deals.filter(d =>
    d.stage === "Closed Won" &&
    d.ownerId === quota.assigneeId &&
    new Date(d.closeDate).getTime() >= start &&
    new Date(d.closeDate).getTime() <= end
  );
  if (quota.type === "Revenue") return closedDeals.reduce((sum, d) => sum + d.value, 0);
  if (quota.type === "Deals Closed") return closedDeals.length;
  return quota.currentValue; // fallback for non-deal quota types
}

/**
 * CONSOLIDATED SIDEBAR NAVIGATION
 * Reduced from 19 items → 13 items in 4 collapsible groups.
 * Sales absorbs: Lead Gen, Pipeline, Sales Hub, Quotas (as sub-tabs)
 * Schedule absorbs: Schedule, Calendar, Activity/Interactions (as sub-tabs)
 * Data Tools renamed → Data Management
 * Intake renamed → Proposals & Intake
 */
export interface NavGroup {
  group: string;
  items: { id: string; label: string; icon: string }[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    group: "MAIN",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "◈" },
      { id: "contacts", label: "Contacts", icon: "◉" },
      { id: "sales", label: "Sales", icon: "◆" },
      { id: "schedule", label: "Schedule", icon: "📅" },
    ],
  },
  {
    group: "WORKSPACE",
    items: [
      { id: "companies", label: "Companies", icon: "🏢" },
      { id: "support", label: "Support", icon: "🎧" },
      { id: "marketing", label: "Marketing", icon: "📣" },
      { id: "team", label: "Team", icon: "👥" },
      { id: "notes", label: "Notes", icon: "📌" },
      { id: "sequences", label: "Sequences", icon: "📬" },
      { id: "packages", label: "Packages", icon: "⊞" },
      { id: "intake", label: "Proposals & Intake", icon: "📋" },
      { id: "email-templates", label: "Email Templates", icon: "✉️" },
      { id: "automations", label: "Automations", icon: "⚡" },
    ],
  },
  {
    group: "INTELLIGENCE",
    items: [
      { id: "analytics", label: "Analytics", icon: "▣" },
      { id: "ai-prospector", label: "AI Prospector", icon: "🔍" },
      { id: "ai", label: "AI", icon: "✦" },
      { id: "portal", label: "Portal", icon: "🌐" },
    ],
  },
  {
    group: "SYSTEM",
    items: [
      { id: "data-tools", label: "Data Management", icon: "📦" },
      { id: "onboarding", label: "Setup", icon: "⊕" },
      { id: "settings", label: "Settings", icon: "⚙" },
    ],
  },
];

// Flat list for backward compatibility (keyboard shortcuts, command palette)
export const NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items);

/** Demo seed bundle — load explicitly via Settings / Data Tools (not auto-synced). */
export function loadDemoWorkspace() {
  return {
    contacts: initialContacts,
    deals: initialDeals,
    notes: initialNotes,
    tasks: initialTasks,
    companies: initialCompanies,
    goals: initialGoals,
    sequences: initialSequences,
    submissions: initialSubmissions,
    quotes: initialQuotes,
    packages: initialPackages,
    meetings: initialMeetings,
    automations: initialAutomations,
    emailLog: initialEmailLog,
    auditLog: initialAuditLog,
    crmQuotas: initialQuotas,
  };
}

export function dealsToCsv(deals: Deal[], customFieldIds?: string[]): string {
  const cfIds = customFieldIds || [...new Set(deals.flatMap((d) => Object.keys(d.customFieldValues || {})))];
  const headers = ["Title", "Contact", "Value", "Stage", "Probability", "Close Date", "Health", ...cfIds];
  const rows = deals.map((d) => [
    d.title, d.contact, d.value, d.stage, d.probability, d.closeDate, d.health,
    ...cfIds.map((id) => d.customFieldValues?.[id] ?? ""),
  ].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export function tasksToCsv(tasks: Task[]): string {
  const headers = ["Title", "Contact", "Due", "Priority", "Done", "Description"];
  const rows = tasks.map((t) => [t.title, t.contact, t.due, t.priority, t.done ? "true" : "false", t.description || ""].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export function companiesToCsv(companies: Company[]): string {
  const headers = ["Name", "Domain", "Industry", "Size", "MRR", "ARR", "Health", "Website", "Tags", "Notes"];
  const rows = companies.map((c) => [
    c.name, c.domain, c.industry, c.size, c.mrr, c.arr, c.health, c.website, (c.tags || []).join(";"), c.notes,
  ].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export function notesToCsv(notes: Note[]): string {
  const headers = ["Contact", "Text", "Date", "Type"];
  const rows = notes.map((n) => [n.contact, n.text, n.date, n.type].map(csvCell).join(","));
  return [headers.join(","), ...rows].join("\n");
}
