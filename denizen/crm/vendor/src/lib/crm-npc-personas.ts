/** Client mirror of denizen/src/denizen-crm-npc-personas.js */
export type CrmNpcPersona = {
  key: string;
  name: string;
  title: string;
  expertise: string;
  canWrite: boolean;
  setupOwner?: string[];
};

export const CRM_READ_SKILLS =
  "crm-summary, crm-setup-status, crm-list-pipeline, crm-list-tasks, crm-at-risk, crm-list-industries";
export const CRM_WRITE_SKILLS =
  "crm-add-contact, crm-update-deal, crm-add-task, crm-apply-industry";

export const CRM_NPC_PERSONAS: CrmNpcPersona[] = [
  { key: "abby", name: "Abby", title: "CTO", expertise: "strategy, team priorities, executive pipeline review", canWrite: true, setupOwner: ["ai", "industry"] },
  { key: "alex", name: "Alex", title: "Senior Developer", expertise: "client demos, product walkthroughs, UI feedback on deals", canWrite: false },
  { key: "bob", name: "Bob", title: "Researcher", expertise: "prospect research, competitive intel, technical discovery on deals", canWrite: false },
  { key: "jenny", name: "Jenny", title: "Developer", expertise: "data migrations, backend delivery timelines, CRM integrations", canWrite: false },
  { key: "dan", name: "Dan", title: "IT Support", expertise: "CRM access, calendar/email integrations, notification setup", canWrite: false, setupOwner: ["profile"] },
  { key: "lucy", name: "Lucy", title: "Receptionist", expertise: "intake, scheduling, contact logging, CRM ops", canWrite: true, setupOwner: ["invite", "intake", "contact"] },
  { key: "bouncer", name: "Bouncer", title: "Security Guard", expertise: "compliance flags, sensitive account handling", canWrite: false },
  { key: "conference_man", name: "Marcus", title: "Project Manager", expertise: "delivery timelines, account health, sprint-linked deals", canWrite: true, setupOwner: ["deal"] },
  { key: "conference_woman", name: "Sarah", title: "Product Manager", expertise: "qualification, industry fit, packages, deal strategy", canWrite: true, setupOwner: ["packages", "industry"] },
  { key: "edward", name: "Edward", title: "Backend Developer", expertise: "deployment scope, infra-heavy proposals, CRM webhooks", canWrite: false },
  { key: "josh", name: "Josh", title: "Frontend Developer", expertise: "UX requirements, intake forms, client portal polish", canWrite: false },
  { key: "molly", name: "Molly", title: "QA Engineer", expertise: "acceptance criteria, release gates on client work", canWrite: false },
  { key: "oscar", name: "Oscar", title: "DevOps Engineer", expertise: "CRM uptime, integrations health, automation reliability", canWrite: false },
  { key: "pier", name: "Pier", title: "Data Engineer", expertise: "CRM data hygiene, spine sync, reporting", canWrite: true },
  { key: "rob", name: "Rob", title: "UI/UX Designer", expertise: "client touchpoints, proposal visuals, brand fit", canWrite: true },
  { key: "roki", name: "Roki", title: "Intern", expertise: "lead lists, follow-up drafts, research support", canWrite: false },
];

export function resolveCrmNpcPersona(keyOrName: string | null | undefined): CrmNpcPersona | null {
  const raw = String(keyOrName || "").trim().toLowerCase();
  if (!raw) return null;
  return CRM_NPC_PERSONAS.find((p) => p.key === raw || p.name.toLowerCase() === raw) || null;
}
