import { useState, useEffect, useMemo } from "react";
import { T, S, type Contact, type Deal, type Task, type AiThread, type AiThreadMessage } from "@/lib/crm-data";
import { assistCrm, executeCrmAssistAction, type CrmWorkspaceState, type CrmAssistAction, type CrmTeamMember } from "@/lib/crm-api";
import { dispatchCrmSubNav } from "@/lib/crm-nav";
import { CRM_NPC_PERSONAS, resolveCrmNpcPersona, type CrmNpcPersona } from "@/lib/crm-npc-personas";
import { useIsMobile } from "@/hooks/use-mobile";

type ChatScope = "mine" | "teammates" | "npc";

const SIDEBAR_KEY = "meridian_ai_sidebar_open";
const SIDEBAR_WIDTH = 280;

interface Props {
  contacts: Contact[];
  deals: Deal[];
  tasks: Task[];
  workspace?: CrmWorkspaceState;
  aiThreads?: AiThread[];
  onSaveAiThreads?: (threads: AiThread[]) => void;
  userName?: string;
  userEmail?: string | null;
  teamMembers?: CrmTeamMember[];
  defaultNpcKey?: string | null;
  onNavigate?: (tab: string) => void;
  onCreateTask?: (task: Partial<Task>) => void;
}

const AUTHOR_COLORS = ["#6366f1", "#22d3a0", "#f0b429", "#8b5cf6", "#4d9ef7", "#fb923c", "#ec4899", "#14b8a6"];

function authorHue(name: string): string {
  const idx = String(name || "?").split("").reduce((s, c) => s + c.charCodeAt(0), 0) % AUTHOR_COLORS.length;
  return AUTHOR_COLORS[idx];
}

function samePerson(a: { name?: string; email?: string | null }, b: { name?: string; email?: string | null }): boolean {
  if (a.email && b.email && a.email.toLowerCase() === b.email.toLowerCase()) return true;
  return !!(a.name && b.name && a.name === b.name);
}

function threadOwner(thread: AiThread): { name: string; email?: string } {
  return { name: thread.ownerName || "Unknown", email: thread.ownerEmail };
}

function isMyThread(thread: AiThread, self: { name: string; email?: string | null }): boolean {
  if (thread.ownerEmail && self.email) {
    return thread.ownerEmail.toLowerCase() === self.email.toLowerCase();
  }
  if (thread.ownerName && self.name) return thread.ownerName === self.name;
  return false;
}

function threadMatchesScope(thread: AiThread, scope: ChatScope, self: { name: string; email?: string | null }): boolean {
  if (scope === "npc") return !!thread.npcKey;
  const mine = isMyThread(thread, self);
  if (scope === "mine") return mine;
  if (scope === "teammates") {
    if (mine) return false;
    return !!(thread.ownerName || thread.ownerEmail) || (!thread.ownerName && !thread.ownerEmail);
  }
  return true;
}

function welcomeForPersona(persona: CrmNpcPersona | null): string {
  if (!persona) {
    return "I'm your Denizen CRM copilot. Ask about pipeline, priorities, intake, or follow-ups.";
  }
  return `Hi — I'm ${persona.name}, your ${persona.title}. I know this team's Meridian CRM (${persona.expertise}).`;
}

function newThread(self: { name: string; email?: string | null }, persona: CrmNpcPersona | null): AiThread {
  const now = new Date().toISOString();
  return {
    id: Date.now(),
    title: persona ? `${persona.name} chat` : "New chat",
    updatedAt: now,
    ownerName: self.name,
    ownerEmail: self.email || undefined,
    npcKey: persona?.key,
    npcName: persona?.name,
    messages: [{ role: "ai", text: welcomeForPersona(persona), speaker: persona?.name, at: now }],
  };
}

function normalizeThreads(threads: AiThread[]): AiThread[] {
  return threads.map((t) => {
    const owner = threadOwner(t);
    const messages = (t.messages || []).map((m) => {
      if (m.role !== "user") return m;
      if (m.speaker && m.authorEmail) return m;
      return {
        ...m,
        speaker: m.speaker || owner.name,
        authorEmail: m.authorEmail || t.ownerEmail,
      };
    });
    const firstUser = messages.find((m) => m.role === "user");
    return {
      ...t,
      messages,
      ownerName: t.ownerName || firstUser?.speaker || undefined,
      ownerEmail: t.ownerEmail || firstUser?.authorEmail || undefined,
    };
  });
}

function threadPreview(thread: AiThread): string {
  const msgs = thread.messages || [];
  for (let i = msgs.length - 1; i >= 0; i -= 1) {
    if (msgs[i].role === "user" && msgs[i].text) return msgs[i].text.slice(0, 72);
  }
  const last = msgs[msgs.length - 1];
  return last?.text?.slice(0, 72) || thread.title;
}

function formatThreadTime(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function readSidebarOpen(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_KEY);
    if (v === "0") return false;
    if (v === "1") return true;
  } catch { /* ignore */ }
  return true;
}

function persistSidebarOpen(open: boolean) {
  try { localStorage.setItem(SIDEBAR_KEY, open ? "1" : "0"); } catch { /* ignore */ }
}

const panelShell: React.CSSProperties = {
  background: T.bg1,
  border: `1px solid ${T.bg3}`,
  borderRadius: 14,
  overflow: "hidden",
};

const iconBtn: React.CSSProperties = {
  background: T.bg2,
  border: `1px solid ${T.bg3}`,
  borderRadius: 8,
  color: T.text2,
  width: 32,
  height: 32,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
  fontSize: 14,
  lineHeight: 1,
};

export function AITab({
  contacts,
  deals,
  tasks,
  workspace,
  aiThreads = [],
  onSaveAiThreads,
  userName = "You",
  userEmail = null,
  teamMembers = [],
  defaultNpcKey = null,
  onNavigate,
  onCreateTask,
}: Props) {
  const isMobile = useIsMobile();
  const self = useMemo(() => ({ name: userName, email: userEmail }), [userName, userEmail]);
  const normalizedThreads = useMemo(() => normalizeThreads(aiThreads), [aiThreads]);

  const [activeId, setActiveId] = useState<number | null>(normalizedThreads[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [pendingActions, setPendingActions] = useState<CrmAssistAction[]>([]);
  const [scope, setScope] = useState<ChatScope>("mine");
  const [selectedNpcKey, setSelectedNpcKey] = useState<string>(defaultNpcKey || "lucy");
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window !== "undefined" ? readSidebarOpen() : true));
  const [teamExpanded, setTeamExpanded] = useState(false);

  const isConfirmAction = (action: CrmAssistAction) =>
    /^(confirm_|crm_capture)/i.test(String(action.type || "")) || action.type === "create_task";

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      persistSidebarOpen(next);
      return next;
    });
  };

  const selectedPersona = resolveCrmNpcPersona(selectedNpcKey);

  const visibleThreads = useMemo(
    () => normalizedThreads
      .filter((t) => threadMatchesScope(t, scope, self))
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))),
    [normalizedThreads, scope, self],
  );

  useEffect(() => {
    if (defaultNpcKey) setSelectedNpcKey(defaultNpcKey);
  }, [defaultNpcKey]);

  useEffect(() => {
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!visibleThreads.length) return;
    if (!visibleThreads.some((t) => t.id === activeId)) {
      setActiveId(visibleThreads[0].id);
    }
  }, [visibleThreads, activeId]);

  useEffect(() => {
    if (aiThreads.length || !onSaveAiThreads) return;
    const persona = resolveCrmNpcPersona(defaultNpcKey || "lucy");
    onSaveAiThreads([newThread(self, persona)]);
  }, [aiThreads.length, onSaveAiThreads, self, defaultNpcKey]);

  const activeThread = visibleThreads.find((t) => t.id === activeId) || visibleThreads[0];
  const activePersona = resolveCrmNpcPersona(activeThread?.npcKey || activeThread?.npcName || selectedNpcKey);
  const messages = activeThread?.messages || [];
  const threadIsMine = activeThread ? isMyThread(activeThread, self) : true;

  const persistThread = (threadId: number, patch: Partial<AiThread>) => {
    if (!onSaveAiThreads) return;
    const updatedAt = new Date().toISOString();
    onSaveAiThreads(
      aiThreads.map((t) => (t.id === threadId ? { ...t, ...patch, updatedAt } : t)),
    );
  };

  const runNavAction = (action: CrmAssistAction) => {
    if (action.type === "open_tab" && action.tab) {
      onNavigate?.(action.tab);
      if (action.tab === "sales") dispatchCrmSubNav("sales", "pipeline");
      if (action.tab === "dashboard") onNavigate?.("dashboard");
    }
  };

  const confirmAction = async (action: CrmAssistAction) => {
    if (!activeThread || confirmBusy) return;
    const persona = activePersona || selectedPersona;
    setConfirmBusy(true);
    const result = await executeCrmAssistAction(action, { npcKey: persona?.key, npcName: persona?.name });
    setConfirmBusy(false);
    setPendingActions((prev) => prev.filter((a) => a !== action));
    const text = result.ok
      ? (result.summary || "Saved to CRM.")
      : (result.error || "Could not save to CRM.");
    persistThread(activeThread.id, {
      messages: [
        ...(activeThread.messages || []),
        {
          role: "ai",
          text: result.ok ? `✓ ${text}` : `Could not save: ${text}`,
          source: result.ok ? "assist-execute" : "error",
          speaker: persona?.name || "AI",
          at: new Date().toISOString(),
        },
      ],
    });
    // Keep local task mirror when confirm_task succeeds and parent can create tasks
    if (result.ok && (action.type === "confirm_task" || action.type === "create_task") && action.payload && onCreateTask) {
      onCreateTask({
        title: String(action.payload.title || action.label),
        contact: String(action.payload.contact || ""),
        priority: String(action.payload.priority || "High"),
        due: String(action.payload.due || new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)),
        done: false,
        status: "todo",
      });
    }
  };

  const send = async () => {
    if (!input.trim() || busy || !activeThread) return;
    const userMsg = input.trim();
    const now = new Date().toISOString();
    const persona = activePersona || selectedPersona;
    const withUser: AiThreadMessage[] = [
      ...messages,
      { role: "user", text: userMsg, speaker: userName, authorEmail: userEmail || undefined, at: now },
    ];
    persistThread(activeThread.id, {
      messages: withUser,
      title: userMsg.slice(0, 48) || activeThread.title,
      ownerName: activeThread.ownerName || userName,
      ownerEmail: activeThread.ownerEmail || userEmail || undefined,
      npcKey: persona?.key || activeThread.npcKey,
      npcName: persona?.name || activeThread.npcName,
    });
    setInput("");
    setBusy(true);
    setPendingActions([]);
    if (isMobile) setSidebarOpen(false);
    const ctx = workspace || { contacts, deals, tasks };
    const result = await assistCrm(userMsg, ctx, { npcKey: persona?.key, npcName: persona?.name });
    setBusy(false);
    if (result.ok && result.reply) {
      persistThread(activeThread.id, {
        messages: [
          ...withUser,
          { role: "ai", text: result.reply, source: result.source, speaker: persona?.name || "AI", at: new Date().toISOString() },
        ],
      });
      const next = result.actions || [];
      const confirmable = next.filter(isConfirmAction);
      const navOnly = next.filter((a) => !isConfirmAction(a));
      navOnly.forEach(runNavAction);
      setPendingActions(confirmable);
    } else {
      persistThread(activeThread.id, {
        messages: [
          ...withUser,
          { role: "ai", text: result.error || "Could not reach Denizen AI.", source: "error", speaker: persona?.name || "AI", at: new Date().toISOString() },
        ],
      });
    }
  };

  const startChat = () => {
    if (!onSaveAiThreads) return;
    const persona = resolveCrmNpcPersona(selectedNpcKey);
    const t = newThread(self, persona);
    onSaveAiThreads([t, ...aiThreads].slice(0, 30));
    setActiveId(t.id);
    setScope("mine");
    if (isMobile) setSidebarOpen(false);
  };

  const pickThread = (id: number) => {
    setActiveId(id);
    if (isMobile) setSidebarOpen(false);
  };

  const scopeBtn = (id: ChatScope, label: string) => (
    <button
      key={id}
      onClick={() => setScope(id)}
      style={{
        flex: 1,
        padding: "6px 4px",
        fontSize: 10,
        fontWeight: 600,
        borderRadius: 6,
        border: `1px solid ${scope === id ? `${T.accent}66` : T.bg4}`,
        background: scope === id ? `${T.accent}18` : T.bg2,
        color: scope === id ? T.accent : T.text3,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );

  const sidebarContent = (
    <>
      <div style={{
        padding: "12px 14px",
        borderBottom: `1px solid ${T.bg3}`,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.text0 }}>Past chats</div>
          <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>{visibleThreads.length} in view</div>
        </div>
        <button type="button" onClick={toggleSidebar} style={iconBtn} title="Collapse sidebar" aria-label="Collapse chat sidebar">
          ‹
        </button>
        {onSaveAiThreads && (
          <button type="button" onClick={startChat} style={{ ...S.btn, padding: "6px 10px", fontSize: 11 }} title="New chat">
            +
          </button>
        )}
      </div>

      <div style={{ padding: "10px 12px", display: "flex", gap: 4, borderBottom: `1px solid ${T.bg3}` }}>
        {scopeBtn("mine", "Mine")}
        {scopeBtn("teammates", "Team")}
        {scopeBtn("npc", "NPC")}
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 4px" }}>
        {visibleThreads.length === 0 ? (
          <div style={{ fontSize: 12, color: T.text3, padding: "16px 10px", lineHeight: 1.5 }}>
            No chats here yet. Tap <strong>+</strong> to start one.
          </div>
        ) : visibleThreads.map((t) => {
          const mine = isMyThread(t, self);
          const owner = t.ownerName || "Unknown";
          const dot = mine ? T.accent : authorHue(owner);
          const active = t.id === activeId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => pickThread(t.id)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "10px 12px",
                marginBottom: 4,
                borderRadius: 10,
                border: `1px solid ${active ? `${dot}55` : "transparent"}`,
                background: active ? `${dot}14` : "transparent",
                cursor: "pointer",
                transition: "background 0.12s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 700, color: T.text0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.title || "Chat"}
                </span>
                <span style={{ fontSize: 9, color: T.text3 }}>{formatThreadTime(t.updatedAt)}</span>
              </div>
              <div style={{ fontSize: 10, color: T.text3, marginBottom: 3 }}>
                {mine ? "You" : owner}{t.npcName ? ` · ${t.npcName}` : ""}
              </div>
              <div style={{ fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {threadPreview(t)}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ borderTop: `1px solid ${T.bg3}`, padding: "8px 10px" }}>
        <button
          type="button"
          onClick={() => setTeamExpanded((v) => !v)}
          style={{
            width: "100%", background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "6px 4px", color: T.text2, fontSize: 11, fontWeight: 700,
          }}
        >
          <span>Team & NPC voice</span>
          <span style={{ fontSize: 10 }}>{teamExpanded ? "▾" : "▸"}</span>
        </button>
        {teamExpanded && (
          <div style={{ padding: "4px 2px 8px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{
              fontSize: 11, padding: "8px 10px", borderRadius: 8,
              background: `${T.accent}12`, border: `1px solid ${T.accent}33`,
            }}>
              <div style={{ fontWeight: 700, color: T.text0 }}>{userName} (you)</div>
              {userEmail && <div style={{ fontSize: 10, color: T.text3 }}>{userEmail}</div>}
            </div>
            {teamMembers.filter((m) => !m.is_self).slice(0, 4).map((m) => (
              <div key={m.email || m.display_name} style={{ fontSize: 11, color: T.text2, paddingLeft: 4 }}>
                <span style={{ color: authorHue(m.display_name), fontWeight: 600 }}>{m.display_name}</span>
                <span style={{ color: T.text3 }}> · {m.role}</span>
              </div>
            ))}
            <select
              value={selectedNpcKey}
              onChange={(e) => setSelectedNpcKey(e.target.value)}
              style={{ ...S.input, fontSize: 11, padding: "8px 10px" } as React.CSSProperties}
            >
              {CRM_NPC_PERSONAS.map((p) => (
                <option key={p.key} value={p.key}>{p.name} — {p.title}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div style={{
      display: "flex",
      height: "calc(100vh - 80px)",
      maxHeight: "calc(100dvh - 80px)",
      gap: 0,
      ...panelShell,
    }}>
      {isMobile && sidebarOpen && (
        <div
          role="presentation"
          onClick={() => setSidebarOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 40,
          }}
        />
      )}

      <aside
        style={{
          width: sidebarOpen ? SIDEBAR_WIDTH : 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          borderRight: sidebarOpen ? `1px solid ${T.bg3}` : "none",
          background: T.bg0 || T.bg1,
          overflow: "hidden",
          transition: "width 0.22s ease",
          position: isMobile ? "fixed" : "relative",
          top: isMobile ? 0 : undefined,
          left: isMobile ? 0 : undefined,
          bottom: isMobile ? 0 : undefined,
          zIndex: isMobile ? 50 : 1,
          maxHeight: "100%",
        }}
      >
        {sidebarOpen && sidebarContent}
      </aside>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, background: T.bg1 }}>
        <div style={{
          padding: "12px 16px",
          borderBottom: `1px solid ${T.bg3}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexShrink: 0,
        }}>
          {!sidebarOpen && (
            <button type="button" onClick={toggleSidebar} style={iconBtn} title="Show past chats" aria-label="Expand chat sidebar">
              ☰
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {activeThread?.title || "AI Assistant"}
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginTop: 2 }}>
              {activePersona ? `${activePersona.name} · ${activePersona.title}` : "CRM copilot"}
              {threadIsMine ? " · your chat" : activeThread?.ownerName ? ` · ${activeThread.ownerName}'s chat` : ""}
            </div>
          </div>
          {!sidebarOpen && onSaveAiThreads && (
            <button type="button" onClick={startChat} style={{ ...S.btnGhost, fontSize: 11, padding: "6px 12px" }}>
              + New
            </button>
          )}
        </div>

        {activeThread && !threadIsMine && (
          <div style={{
            margin: "10px 16px 0",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 11,
            background: `${authorHue(activeThread.ownerName || "?")}12`,
            border: `1px solid ${T.bg4}`,
            color: T.text2,
          }}>
            Viewing <strong>{activeThread.ownerName || "teammate"}</strong>&apos;s thread — their messages use their color, yours show as <strong>YOU</strong>.
          </div>
        )}

        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}>
          {messages.map((m, i) => {
            const isSelf = m.role === "user" && samePerson({ name: m.speaker, email: m.authorEmail }, self);
            const teammateColor = authorHue(m.speaker || "team");
            const isAi = m.role === "ai";
            return (
              <div key={i} style={{
                alignSelf: isAi ? "flex-start" : "flex-end",
                maxWidth: "min(520px, 92%)",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: isAi ? "flex-start" : "flex-end",
              }}>
                <div style={{
                  fontSize: 10,
                  fontWeight: 700,
                  marginBottom: 5,
                  color: isAi ? (T.purple || "#8b5cf6") : (isSelf ? T.accent : teammateColor),
                  letterSpacing: "0.03em",
                }}>
                  {isAi ? (m.speaker || "AI") : (isSelf ? "YOU" : (m.speaker || "Teammate"))}
                </div>
                <div style={{
                  background: isAi
                    ? T.bg2
                    : (isSelf ? `linear-gradient(135deg,${T.accent},#d97706)` : `linear-gradient(135deg,${teammateColor},${teammateColor}bb)`),
                  color: isAi ? T.text1 : "#080d18",
                  border: `1px solid ${isAi ? T.bg4 : `${isSelf ? T.accent : teammateColor}44`}`,
                  borderRadius: isAi ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
                  padding: "12px 16px",
                  fontSize: 13,
                  lineHeight: 1.65,
                  whiteSpace: "pre-wrap",
                  boxShadow: isAi ? "none" : "0 2px 8px rgba(0,0,0,0.12)",
                }}>
                  {m.text}
                </div>
              </div>
            );
          })}
          {busy && (
            <div style={{ fontSize: 12, color: T.text3, paddingLeft: 4 }}>
              {activePersona?.name || "AI"} is thinking…
            </div>
          )}
          {pendingActions.length > 0 && (
            <div style={{
              alignSelf: "flex-start",
              maxWidth: "min(520px, 92%)",
              padding: "10px 12px",
              borderRadius: 10,
              border: `1px solid ${T.accent}44`,
              background: `${T.accent}10`,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.text0 }}>
                Confirm to update CRM
              </div>
              {pendingActions.map((action, idx) => (
                <div key={`${action.type}-${idx}`} style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, color: T.text2, flex: 1, minWidth: 120 }}>{action.label}</span>
                  <button
                    type="button"
                    disabled={confirmBusy}
                    onClick={() => confirmAction(action)}
                    style={{
                      ...S.btn,
                      padding: "6px 12px",
                      fontSize: 11,
                      opacity: confirmBusy ? 0.6 : 1,
                    } as React.CSSProperties}
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={confirmBusy}
                    onClick={() => setPendingActions((prev) => prev.filter((a) => a !== action))}
                    style={{
                      ...S.btnGhost,
                      padding: "6px 12px",
                      fontSize: 11,
                    } as React.CSSProperties}
                  >
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{
          padding: "12px 16px 16px",
          borderTop: `1px solid ${T.bg3}`,
          display: "flex",
          gap: 8,
          flexShrink: 0,
          background: T.bg1,
        }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && !busy && send()}
            placeholder={threadIsMine ? `Message ${activePersona?.name || "AI"}…` : `Reply as ${userName}…`}
            disabled={busy}
            style={{
              ...S.input,
              flex: 1,
              padding: "12px 16px",
              fontSize: 14,
              borderRadius: 12,
            } as React.CSSProperties}
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            style={{
              ...S.btn,
              padding: "12px 20px",
              borderRadius: 12,
              opacity: busy || !input.trim() ? 0.5 : 1,
            } as React.CSSProperties}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
