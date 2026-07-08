import { useState, useEffect, useMemo } from "react";
import { T, S, STAGES } from "@/lib/crm-data";
import { INDUSTRY_TEMPLATES, type IndustryConfig, type CustomFieldDef, type IndustryTerminology } from "@/lib/industry-config";
import { markCrmUserEdited } from "@/lib/crm-api";

type NotifPrefs = { email: boolean; inApp: boolean; dealAlerts: boolean; taskReminders: boolean; weeklyDigest: boolean };

interface Props {
  industryConfig: IndustryConfig;
  onUpdateConfig: (config: IndustryConfig) => void;
  profile?: { name: string; role: string };
  userPrefs?: Record<string, unknown>;
  onSaveUserPrefs?: (prefs: Record<string, unknown>) => void;
  integrations?: Record<string, unknown>;
  onSaveIntegrations?: (v: Record<string, unknown>) => void;
  availability?: unknown[];
  onSaveAvailability?: (slots: unknown[]) => void;
  onLoadDemoData?: () => void;
}

export function SettingsTab({
  industryConfig, onUpdateConfig, profile: denizenProfile, userPrefs = {}, onSaveUserPrefs,
  integrations = {}, onSaveIntegrations, onLoadDemoData,
}: Props) {
  const savedProfile = (userPrefs.profile as { email?: string; timezone?: string }) || {};
  const savedNotif = (userPrefs.notifications as NotifPrefs) || { email: true, inApp: true, dealAlerts: true, taskReminders: true, weeklyDigest: true };

  const [profile, setProfile] = useState({
    name: "Guest",
    email: savedProfile.email || "",
    role: "Team member",
    timezone: savedProfile.timezone || "America/New_York",
  });
  const [notifPrefs, setNotifPrefs] = useState<NotifPrefs>(savedNotif);
  useEffect(() => {
    if (!denizenProfile) return;
    setProfile((p) => ({ ...p, name: denizenProfile.name, role: denizenProfile.role }));
  }, [denizenProfile?.name, denizenProfile?.role]);
  useEffect(() => {
    const p = (userPrefs.profile as { email?: string; timezone?: string }) || {};
    const n = (userPrefs.notifications as NotifPrefs) || savedNotif;
    setProfile((prev) => ({
      ...prev,
      email: p.email ?? prev.email,
      timezone: p.timezone ?? prev.timezone,
    }));
    setNotifPrefs(n);
  }, [userPrefs]);
  const [saved, setSaved] = useState(false);
  const savedHooks = (integrations.outboundWebhooks as { deal_won?: string; contact_added?: string }) || {};
  const [dealWonWebhook, setDealWonWebhook] = useState(savedHooks.deal_won || "");
  const [contactAddedWebhook, setContactAddedWebhook] = useState(savedHooks.contact_added || "");
  const [webhooksSaved, setWebhooksSaved] = useState(false);
  useEffect(() => {
    const hooks = (integrations.outboundWebhooks as { deal_won?: string; contact_added?: string }) || {};
    setDealWonWebhook(hooks.deal_won || "");
    setContactAddedWebhook(hooks.contact_added || "");
  }, [integrations]);
  const [activeSection, setActiveSection] = useState<"profile" | "industry" | "terminology" | "stages" | "fields" | "notifications" | "integrations">("profile");

  // Local editable copy of config
  const [localConfig, setLocalConfig] = useState<IndustryConfig>(() => JSON.parse(JSON.stringify(industryConfig)));
  const [newFieldForm, setNewFieldForm] = useState<Partial<CustomFieldDef> & { open?: boolean }>({});
  const [newStage, setNewStage] = useState("");
  const [newStatus, setNewStatus] = useState("");
  const [newNoteType, setNewNoteType] = useState("");
  const [configSaved, setConfigSaved] = useState(false);
  const [industrySearch, setIndustrySearch] = useState("");

  const filteredIndustryTemplates = useMemo(() => {
    const q = industrySearch.trim().toLowerCase();
    if (!q) return INDUSTRY_TEMPLATES;
    return INDUSTRY_TEMPLATES.filter((tmpl) =>
      tmpl.name.toLowerCase().includes(q)
      || (tmpl.industry || tmpl.id).toLowerCase().includes(q)
      || tmpl.id.toLowerCase().includes(q),
    );
  }, [industrySearch]);

  const handleSave = () => {
    onSaveUserPrefs?.({
      ...userPrefs,
      profile: { email: profile.email, timezone: profile.timezone },
      notifications: notifPrefs,
    });
    markCrmUserEdited();
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleSaveConfig = () => {
    onUpdateConfig(localConfig);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  };

  const handleSelectTemplate = (template: IndustryConfig) => {
    const cloned = JSON.parse(JSON.stringify(template));
    setLocalConfig(cloned);
    onUpdateConfig(cloned);
    setConfigSaved(true);
    setTimeout(() => setConfigSaved(false), 2000);
  };

  const updateTerm = (key: keyof IndustryTerminology, value: string) => {
    setLocalConfig(prev => ({ ...prev, terminology: { ...prev.terminology, [key]: value } }));
  };

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0" }}>
      <span style={{ fontSize: 13, color: T.text1 }}>{label}</span>
      <button onClick={onChange} style={{
        width: 40, height: 22, borderRadius: 11, border: "none", cursor: "pointer",
        background: checked ? T.accent : T.bg4, position: "relative", transition: "all 0.2s",
      }}>
        <div style={{
          width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute",
          top: 3, left: checked ? 21 : 3, transition: "left 0.2s",
        }} />
      </button>
    </div>
  );

  const cardStyle = {
    background: `linear-gradient(145deg,${T.bg2},${T.bg3}88)`,
    border: `1px solid ${T.bg4}`, borderRadius: T.radius.lg, padding: "20px 22px",
    marginBottom: 14,
  };

  const sections = [
    { id: "profile", icon: "👤", label: "Profile" },
    { id: "industry", icon: "🏭", label: "Industry" },
    { id: "terminology", icon: "📝", label: "Terminology" },
    { id: "stages", icon: "◆", label: "Stages & Statuses" },
    { id: "fields", icon: "📋", label: "Custom Fields" },
    { id: "notifications", icon: "🔔", label: "Notifications" },
    { id: "integrations", icon: "🔌", label: "Integrations" },
  ] as const;

  const handleSaveWebhooks = () => {
    onSaveIntegrations?.({
      ...integrations,
      outboundWebhooks: {
        deal_won: dealWonWebhook.trim(),
        contact_added: contactAddedWebhook.trim(),
      },
    });
    markCrmUserEdited();
    setWebhooksSaved(true);
    setTimeout(() => setWebhooksSaved(false), 2000);
  };

  const addCustomField = () => {
    if (!newFieldForm.label?.trim()) return;
    const field: CustomFieldDef = {
      id: `cf_${Date.now()}`,
      label: newFieldForm.label.trim(),
      type: (newFieldForm.type as CustomFieldDef["type"]) || "text",
      entity: (newFieldForm.entity as "contact" | "deal") || "contact",
      options: newFieldForm.type === "select" ? (newFieldForm.options || []) : undefined,
    };
    setLocalConfig(prev => ({ ...prev, customFields: [...prev.customFields, field] }));
    setNewFieldForm({});
  };

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>⚙️ Settings</h1>
        <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>Profile, industry config, custom fields & preferences</p>
      </div>

      {/* Section tabs */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => setActiveSection(s.id)} style={{
            padding: "7px 14px", borderRadius: T.radius.full, fontSize: 12, fontWeight: 600,
            background: activeSection === s.id ? `${T.accent}22` : T.bg3,
            color: activeSection === s.id ? T.accent : T.text3,
            border: `1px solid ${activeSection === s.id ? `${T.accent}66` : T.bg4}`,
            cursor: "pointer", transition: "all 0.15s",
          }}>{s.icon} {s.label}</button>
        ))}
      </div>

      {/* PROFILE */}
      {activeSection === "profile" && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 16 }}>👤 Profile</div>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
            <div style={{
              width: 56, height: 56, borderRadius: T.radius.lg,
              background: `linear-gradient(135deg,${T.purple},${T.bg4})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, fontWeight: 700, color: "#fff",
            }}>{profile.name.split(" ").map(n => n[0]).join("")}</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>{profile.name}</div>
              <div style={{ fontSize: 12, color: T.text3 }}>{profile.role}</div>
            </div>
          </div>
          {[["name", "Name"], ["email", "Email"], ["role", "Role"], ["timezone", "Timezone"]].map(([key, label]) => (
            <div key={key} style={{ marginBottom: 12 }}>
              <label style={S.label as React.CSSProperties}>{label}</label>
              <input value={(profile as any)[key]} onChange={e => setProfile(p => ({ ...p, [key]: e.target.value }))}
                style={S.input as React.CSSProperties} />
            </div>
          ))}
          <p style={{ fontSize: 12, color: T.text3, margin: "12px 0 0", lineHeight: 1.5 }}>
            Name and role come from your Denizen office session. Export data from Data Tools before resetting local storage.
          </p>
          <button onClick={handleSave} style={{
            ...S.btn as React.CSSProperties, marginTop: 8,
            background: saved ? T.green : T.accent, transition: "all 0.2s",
          }}>
            {saved ? "✓ Saved!" : "Save Profile"}
          </button>
          {onLoadDemoData && (
            <button onClick={onLoadDemoData} style={{
              ...S.btn as React.CSSProperties, marginTop: 10, background: T.bg4, color: T.text1,
            }}>
              Load sample CRM data
            </button>
          )}
        </div>
      )}

      {/* INDUSTRY TEMPLATE SELECTOR */}
      {activeSection === "industry" && (
        <div>
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 6 }}>🏭 Industry Template</div>
            <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>
              Select a template to auto-configure terminology, pipeline stages, and custom fields for your industry.
            </p>
            <input
              value={industrySearch}
              onChange={(e) => setIndustrySearch(e.target.value)}
              placeholder="Search industries (e.g. SaaS, govcon, healthcare)…"
              style={{ ...S.input as React.CSSProperties, marginBottom: 14, maxWidth: 420 }}
            />
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 10 }}>
              {filteredIndustryTemplates.length} of {INDUSTRY_TEMPLATES.length} templates
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10 }}>
              {filteredIndustryTemplates.map(tmpl => {
                const active = localConfig.id === tmpl.id;
                return (
                  <button key={tmpl.id} onClick={() => handleSelectTemplate(tmpl)} style={{
                    padding: "16px 14px", borderRadius: T.radius.lg, cursor: "pointer",
                    background: active ? `${T.accent}14` : `linear-gradient(145deg,${T.bg3},${T.bg4}44)`,
                    border: `1.5px solid ${active ? T.accent : T.bg4}`,
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                    transition: "all 0.15s",
                  }}>
                    <span style={{ fontSize: 28 }}>{tmpl.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: active ? T.accent : T.text1 }}>{tmpl.name}</span>
                    <span style={{ fontSize: 10, color: T.text3, textAlign: "center" }}>
                      {tmpl.pipelineStages.length} stages · {tmpl.customFields.length} fields
                    </span>
                    {active && <span style={{ fontSize: 10, color: T.accent, fontWeight: 700 }}>✓ Active</span>}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Current config summary */}
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>📋 Current Configuration</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Terminology</div>
                {(["contact", "deal", "pipeline", "company", "value", "closeDate"] as const).map(k => (
                  <div key={k} style={{ fontSize: 12, color: T.text2, padding: "3px 0" }}>
                    <span style={{ color: T.text3 }}>{k}:</span> {localConfig.terminology[k]}
                  </div>
                ))}
              </div>
              <div>
                <div style={{ fontSize: 11, color: T.text3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Pipeline Stages</div>
                {localConfig.pipelineStages.map((s, i) => (
                  <div key={i} style={{ fontSize: 12, color: T.text2, padding: "3px 0" }}>{i + 1}. {s}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TERMINOLOGY EDITOR */}
      {activeSection === "terminology" && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 6 }}>📝 Custom Terminology</div>
          <p style={{ fontSize: 12, color: T.text3, marginBottom: 16 }}>
            Rename entities to match your industry language. Changes appear across the entire CRM.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {(Object.keys(localConfig.terminology) as (keyof IndustryTerminology)[]).map(key => (
              <div key={key} style={{ marginBottom: 4 }}>
                <label style={{ ...S.label as React.CSSProperties, textTransform: "capitalize" }}>{key.replace(/([A-Z])/g, " $1")}</label>
                <input
                  value={localConfig.terminology[key]}
                  onChange={e => updateTerm(key, e.target.value)}
                  style={S.input as React.CSSProperties}
                />
              </div>
            ))}
          </div>
          <button onClick={handleSaveConfig} style={{
            ...S.btn as React.CSSProperties, marginTop: 16,
            background: configSaved ? T.green : T.accent, transition: "all 0.2s",
          }}>
            {configSaved ? "✓ Saved!" : "Save Terminology"}
          </button>
        </div>
      )}

      {/* STAGES & STATUSES */}
      {activeSection === "stages" && (
        <div>
          {/* Pipeline Stages */}
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>◆ {localConfig.terminology.pipeline} Stages</div>
            <p style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>Drag to reorder or add/remove stages.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {localConfig.pipelineStages.map((stage, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
                  padding: "8px 12px",
                }}>
                  <span style={{ color: T.text3, fontSize: 12, width: 22, textAlign: "center" }}>{i + 1}</span>
                  <input
                    value={stage}
                    onChange={e => {
                      const stages = [...localConfig.pipelineStages];
                      stages[i] = e.target.value;
                      setLocalConfig(prev => ({ ...prev, pipelineStages: stages }));
                    }}
                    style={{ ...S.input as React.CSSProperties, background: "transparent", border: "none", padding: "4px 0", flex: 1 }}
                  />
                  <button onClick={() => {
                    if (i > 0) {
                      const stages = [...localConfig.pipelineStages];
                      [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]];
                      setLocalConfig(prev => ({ ...prev, pipelineStages: stages }));
                    }
                  }} style={{ background: "none", border: "none", color: i > 0 ? T.text2 : T.bg4, cursor: i > 0 ? "pointer" : "default", fontSize: 14 }}>↑</button>
                  <button onClick={() => {
                    if (i < localConfig.pipelineStages.length - 1) {
                      const stages = [...localConfig.pipelineStages];
                      [stages[i], stages[i + 1]] = [stages[i + 1], stages[i]];
                      setLocalConfig(prev => ({ ...prev, pipelineStages: stages }));
                    }
                  }} style={{ background: "none", border: "none", color: i < localConfig.pipelineStages.length - 1 ? T.text2 : T.bg4, cursor: i < localConfig.pipelineStages.length - 1 ? "pointer" : "default", fontSize: 14 }}>↓</button>
                  <button onClick={() => {
                    setLocalConfig(prev => ({ ...prev, pipelineStages: prev.pipelineStages.filter((_, j) => j !== i) }));
                  }} style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14 }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <input value={newStage} onChange={e => setNewStage(e.target.value)} placeholder="New stage name…" style={{ ...S.input as React.CSSProperties, flex: 1 }} />
              <button onClick={() => { if (!newStage.trim()) return; setLocalConfig(prev => ({ ...prev, pipelineStages: [...prev.pipelineStages, newStage.trim()] })); setNewStage(""); }}
                style={{ ...S.btn as React.CSSProperties, padding: "8px 14px", fontSize: 12 }}>Add</button>
            </div>
          </div>

          {/* Contact Statuses */}
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>◉ {localConfig.terminology.contact} Statuses</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {localConfig.contactStatuses.map((status, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm,
                  padding: "6px 10px", fontSize: 12, color: T.text1,
                }}>
                  {status}
                  <button onClick={() => setLocalConfig(prev => ({ ...prev, contactStatuses: prev.contactStatuses.filter((_, j) => j !== i) }))}
                    style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={newStatus} onChange={e => setNewStatus(e.target.value)} placeholder="New status…" style={{ ...S.input as React.CSSProperties, flex: 1 }} />
              <button onClick={() => { if (!newStatus.trim()) return; setLocalConfig(prev => ({ ...prev, contactStatuses: [...prev.contactStatuses, newStatus.trim()] })); setNewStatus(""); }}
                style={{ ...S.btn as React.CSSProperties, padding: "8px 14px", fontSize: 12 }}>Add</button>
            </div>
          </div>

          {/* Note Types */}
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>📌 {localConfig.terminology.note} Types</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {localConfig.noteTypes.map((type, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6,
                  background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.sm,
                  padding: "6px 10px", fontSize: 12, color: T.text1,
                }}>
                  {type}
                  <button onClick={() => setLocalConfig(prev => ({ ...prev, noteTypes: prev.noteTypes.filter((_, j) => j !== i) }))}
                    style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 12, padding: 0 }}>✕</button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={newNoteType} onChange={e => setNewNoteType(e.target.value)} placeholder="New type…" style={{ ...S.input as React.CSSProperties, flex: 1 }} />
              <button onClick={() => { if (!newNoteType.trim()) return; setLocalConfig(prev => ({ ...prev, noteTypes: [...prev.noteTypes, newNoteType.trim()] })); setNewNoteType(""); }}
                style={{ ...S.btn as React.CSSProperties, padding: "8px 14px", fontSize: 12 }}>Add</button>
            </div>
          </div>

          <button onClick={handleSaveConfig} style={{
            ...S.btn as React.CSSProperties,
            background: configSaved ? T.green : T.accent, transition: "all 0.2s",
          }}>
            {configSaved ? "✓ Saved!" : "Save Stages & Statuses"}
          </button>
        </div>
      )}

      {/* CUSTOM FIELDS */}
      {activeSection === "fields" && (
        <div>
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 6 }}>📋 Custom Fields</div>
            <p style={{ fontSize: 12, color: T.text3, marginBottom: 16 }}>
              Add custom fields to {localConfig.terminology.contacts.toLowerCase()} and {localConfig.terminology.deals.toLowerCase()}.
            </p>

            {/* Existing fields */}
            {localConfig.customFields.length === 0 && (
              <div style={{ textAlign: "center", padding: 20, color: T.text3, fontSize: 13 }}>No custom fields configured yet.</div>
            )}
            {(["contact", "deal"] as const).map(entity => {
              const fields = localConfig.customFields.filter(f => f.entity === entity);
              if (fields.length === 0) return null;
              return (
                <div key={entity} style={{ marginBottom: 16 }}>
                  <div style={{ ...S.sectionLabel as React.CSSProperties, marginTop: 0 }}>
                    {entity === "contact" ? localConfig.terminology.contact : localConfig.terminology.deal} Fields
                  </div>
                  {fields.map(field => (
                    <div key={field.id} style={{
                      display: "flex", alignItems: "center", gap: 10,
                      background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md,
                      padding: "10px 12px", marginBottom: 6,
                    }}>
                      <span style={{ fontSize: 12, color: T.text1, flex: 1, fontWeight: 600 }}>{field.label}</span>
                      <span style={{
                        fontSize: 10, padding: "2px 8px", borderRadius: T.radius.sm,
                        background: `${T.blue}18`, color: T.blue, fontWeight: 600,
                      }}>{field.type}</span>
                      {field.options && (
                        <span style={{ fontSize: 10, color: T.text3 }}>{field.options.length} options</span>
                      )}
                      <button onClick={() => setLocalConfig(prev => ({ ...prev, customFields: prev.customFields.filter(f => f.id !== field.id) }))}
                        style={{ background: "none", border: "none", color: T.red, cursor: "pointer", fontSize: 14 }}>✕</button>
                    </div>
                  ))}
                </div>
              );
            })}

            {/* Add new field form */}
            {newFieldForm.open ? (
              <div style={{ background: T.bg3, border: `1px solid ${T.bg5}`, borderRadius: T.radius.lg, padding: 16, marginTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: T.text0, marginBottom: 12 }}>Add Custom Field</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={S.label as React.CSSProperties}>Field Label *</label>
                    <input value={newFieldForm.label || ""} onChange={e => setNewFieldForm(p => ({ ...p, label: e.target.value }))}
                      style={S.input as React.CSSProperties} placeholder="e.g. Property Type" />
                  </div>
                  <div>
                    <label style={S.label as React.CSSProperties}>Field Type</label>
                    <select value={newFieldForm.type || "text"} onChange={e => setNewFieldForm(p => ({ ...p, type: e.target.value as any }))}
                      style={S.input as React.CSSProperties}>
                      {["text", "number", "select", "date", "checkbox", "url", "email", "textarea"].map(t => (
                        <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={S.label as React.CSSProperties}>Applies To</label>
                    <select value={newFieldForm.entity || "contact"} onChange={e => setNewFieldForm(p => ({ ...p, entity: e.target.value as any }))}
                      style={S.input as React.CSSProperties}>
                      <option value="contact">{localConfig.terminology.contacts}</option>
                      <option value="deal">{localConfig.terminology.deals}</option>
                    </select>
                  </div>
                  {newFieldForm.type === "select" && (
                    <div>
                      <label style={S.label as React.CSSProperties}>Options (comma-separated)</label>
                      <input
                        value={(newFieldForm.options || []).join(", ")}
                        onChange={e => setNewFieldForm(p => ({ ...p, options: e.target.value.split(",").map(s => s.trim()).filter(Boolean) }))}
                        style={S.input as React.CSSProperties}
                        placeholder="Option 1, Option 2, …"
                      />
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                  <button onClick={addCustomField} style={{ ...S.btn as React.CSSProperties, padding: "8px 14px", fontSize: 12 }}>Add Field</button>
                  <button onClick={() => setNewFieldForm({})} style={{ ...S.btnGhost as React.CSSProperties, padding: "8px 14px", fontSize: 12 }}>Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setNewFieldForm({ open: true, type: "text", entity: "contact" })}
                style={{ ...S.btnGhost as React.CSSProperties, marginTop: 8, width: "100%", borderStyle: "dashed" }}>
                + Add Custom Field
              </button>
            )}
          </div>
          <button onClick={handleSaveConfig} style={{
            ...S.btn as React.CSSProperties,
            background: configSaved ? T.green : T.accent, transition: "all 0.2s",
          }}>
            {configSaved ? "✓ Saved!" : "Save Custom Fields"}
          </button>
        </div>
      )}

      {/* INTEGRATIONS */}
      {activeSection === "integrations" && (
        <div style={cardStyle}>
          <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 6 }}>🔌 Outbound webhooks (n8n)</div>
          <p style={{ fontSize: 12, color: T.text3, marginBottom: 16, lineHeight: 1.5 }}>
            Denizen POSTs JSON to these URLs when events fire. In n8n, add a <strong>Webhook</strong> trigger node
            (POST), copy its URL (e.g. <code style={{ fontSize: 11 }}>http://192.168.1.50:5678/webhook/deal-won</code> on your NAS),
            and paste it here. The Denizen server must be able to reach your n8n host (same LAN is fine).
            Inbound leads still go to <code style={{ fontSize: 11 }}>POST /api/crm/intake</code>.
          </p>
          <label style={S.label as React.CSSProperties}>Deal won → n8n webhook URL</label>
          <input
            value={dealWonWebhook}
            onChange={(e) => setDealWonWebhook(e.target.value)}
            placeholder="http://192.168.1.50:5678/webhook/deal-won"
            style={{ ...S.input as React.CSSProperties, marginBottom: 12, width: "100%" }}
          />
          <label style={S.label as React.CSSProperties}>Contact added → n8n webhook URL</label>
          <input
            value={contactAddedWebhook}
            onChange={(e) => setContactAddedWebhook(e.target.value)}
            placeholder="http://192.168.1.50:5678/webhook/contact-added"
            style={{ ...S.input as React.CSSProperties, marginBottom: 16, width: "100%" }}
          />
          <button onClick={handleSaveWebhooks} style={{ ...S.btn as React.CSSProperties, background: webhooksSaved ? T.green : T.accent }}>
            {webhooksSaved ? "✓ Saved!" : "Save webhook URLs"}
          </button>
        </div>
      )}

      {/* NOTIFICATIONS */}
      {activeSection === "notifications" && (
        <div>
          <div style={cardStyle}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.text0, marginBottom: 12 }}>🔔 Notification Preferences</div>
            <Toggle label="Email notifications" checked={notifPrefs.email} onChange={() => setNotifPrefs(p => ({ ...p, email: !p.email }))} />
            <Toggle label="In-app notifications" checked={notifPrefs.inApp} onChange={() => setNotifPrefs(p => ({ ...p, inApp: !p.inApp }))} />
            <Toggle label={`${localConfig.terminology.deal} stage alerts`} checked={notifPrefs.dealAlerts} onChange={() => setNotifPrefs(p => ({ ...p, dealAlerts: !p.dealAlerts }))} />
            <Toggle label={`${localConfig.terminology.task} reminders`} checked={notifPrefs.taskReminders} onChange={() => setNotifPrefs(p => ({ ...p, taskReminders: !p.taskReminders }))} />
            <Toggle label="Weekly performance digest" checked={notifPrefs.weeklyDigest} onChange={() => setNotifPrefs(p => ({ ...p, weeklyDigest: !p.weeklyDigest }))} />
          </div>

          {/* Danger zone */}
          <div style={{ ...cardStyle, borderColor: `${T.red}33` }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.red, marginBottom: 12 }}>🗑 Danger Zone</div>
            <div style={{ fontSize: 12, color: T.text3, marginBottom: 12 }}>These actions cannot be undone.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={{ background: `${T.red}18`, color: T.red, border: `1px solid ${T.red}33`, borderRadius: T.radius.md, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                Reset All Data
              </button>
              <button style={{ background: `${T.red}18`, color: T.red, border: `1px solid ${T.red}33`, borderRadius: T.radius.md, padding: "8px 14px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                Delete Account
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
