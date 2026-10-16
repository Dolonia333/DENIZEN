import { useEffect, useMemo, useState } from "react";
import { T, S, type Contact, type Deal } from "@/lib/crm-data";
import type { EmailTemplate } from "./EmailTemplatesTab";
import { applyTemplate, buildMergeContext } from "@/lib/crm-email-merge";
import { sendCrmEmail, type CrmSendEmailResult } from "@/lib/crm-api";

export interface ComposeSeed {
  contactId?: number;
  dealId?: number;
  templateId?: number;
  subject?: string;
  body?: string;
  toEmail?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  contacts: Contact[];
  deals: Deal[];
  templates: EmailTemplate[];
  senderName: string;
  seed?: ComposeSeed | null;
  onSent: (result: CrmSendEmailResult) => void;
}

export function EmailComposeModal({
  open,
  onClose,
  contacts,
  deals,
  templates,
  senderName,
  seed,
  onSent,
}: Props) {
  const [contactId, setContactId] = useState<number | "">("");
  const [dealId, setDealId] = useState<number | "">("");
  const [templateId, setTemplateId] = useState<number | "">("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setContactId(seed?.contactId ?? "");
    setDealId(seed?.dealId ?? "");
    setTemplateId(seed?.templateId ?? "");
    setSubject(seed?.subject ?? "");
    setBody(seed?.body ?? "");
    setToEmail(seed?.toEmail ?? "");
    setPreview(false);
  }, [open, seed]);

  const contact = useMemo(
    () => contacts.find((c) => c.id === contactId) || null,
    [contacts, contactId],
  );

  const deal = useMemo(() => {
    if (dealId !== "") return deals.find((d) => d.id === dealId) || null;
    if (contact) return deals.find((d) => d.contact === contact.name) || null;
    return null;
  }, [deals, dealId, contact]);

  const template = useMemo(
    () => templates.find((t) => t.id === templateId) || null,
    [templates, templateId],
  );

  const ctx = useMemo(
    () => buildMergeContext(contact, deal, senderName),
    [contact, deal, senderName],
  );

  useEffect(() => {
    if (!open || !template) return;
    const merged = applyTemplate(template, ctx);
    setSubject(merged.subject);
    setBody(merged.body);
  }, [open, template, ctx]);

  useEffect(() => {
    if (contact?.email && !toEmail) setToEmail(contact.email);
  }, [contact, toEmail]);

  if (!open) return null;

  function mergePreview(text: string) {
    return text
      .replace(/\{\{name\}\}/g, ctx.name || "")
      .replace(/\{\{company\}\}/g, ctx.company || "")
      .replace(/\{\{email\}\}/g, ctx.email || "")
      .replace(/\{\{deal\.title\}\}/g, ctx.dealTitle || "")
      .replace(/\{\{deal\.value\}\}/g, ctx.dealValue || "")
      .replace(/\{\{sender\.name\}\}/g, ctx.senderName || "Team");
  }

  const previewSubject = mergePreview(subject);
  const previewBody = mergePreview(body);

  const send = async (forceMailto = false) => {
    setError(null);
    if (!toEmail.trim()) {
      setError("Recipient email is required");
      return;
    }
    setBusy(true);
    const result = await sendCrmEmail({
      contactId: contactId === "" ? undefined : contactId,
      dealId: deal?.id,
      toEmail: toEmail.trim(),
      subject,
      body,
      templateId: templateId === "" ? undefined : templateId,
      forceMailto,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error || "Send failed");
      return;
    }
    onSent(result);
    onClose();
  };

  return (
    <div style={S.modalBg as React.CSSProperties} onClick={onClose} role="dialog" aria-modal="true">
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...S.modalBox as React.CSSProperties, width: 640, maxHeight: "90vh" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: T.text0 }}>✉️ Compose Email</h2>
          <button aria-label="Close" type="button" onClick={onClose} style={{ background: "none", border: "none", color: T.text3, cursor: "pointer", fontSize: 18 }}>×</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.label as React.CSSProperties}>Contact</label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value ? Number(e.target.value) : "")}
              style={S.input as React.CSSProperties}
            >
              <option value="">— Select contact —</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} ({c.company || "—"})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={S.label as React.CSSProperties}>Template (optional)</label>
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : "")}
              style={S.input as React.CSSProperties}
            >
              <option value="">— Custom —</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={S.label as React.CSSProperties}>To email *</label>
            <input value={toEmail} onChange={(e) = aria-label="input"> setToEmail(e.target.value)} style={S.input as React.CSSProperties} placeholder="client@company.com" />
          </div>
          <div>
            <label style={S.label as React.CSSProperties}>Related deal</label>
            <select
              value={dealId}
              onChange={(e) => setDealId(e.target.value ? Number(e.target.value) : "")}
              style={S.input as React.CSSProperties}
            >
              <option value="">— Auto / none —</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>{d.title}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.label as React.CSSProperties}>Subject</label>
          <input value={subject} onChange={(e) = aria-label="input"> setSubject(e.target.value)} style={S.input as React.CSSProperties} />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={S.label as React.CSSProperties}>Body</label>
          <textarea
            value={body}
            onChange={(e) = aria-label="textarea"> setBody(e.target.value)}
            style={{ ...S.input as React.CSSProperties, minHeight: 180, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6 }}
          />
        </div>

        {preview && (
          <div style={{ background: T.bg3, border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, padding: 14, marginBottom: 12 }}>
            <div style={{ fontSize: 14, color: T.text3, marginBottom: 6 }}>Preview</div>
            <div style={{ fontWeight: 600, color: T.text0, marginBottom: 8 }}>{previewSubject || "(No subject)"}</div>
            <div style={{ fontSize: 14, color: T.text1, whiteSpace: "pre-wrap" }}>{previewBody || "(Empty)"}</div>
          </div>
        )}

        {error && (
          <div style={{ color: T.red, fontSize: 14, marginBottom: 12 }}>{error}</div>
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          <button aria-label="Action" type="button" onClick={() => setPreview((p) => !p)} style={S.btnGhost as React.CSSProperties}>
            {preview ? "Hide preview" : "Preview"}
          </button>
          <button aria-label="Action" type="button" disabled={busy} onClick={() => send(true)} style={S.btnGhost as React.CSSProperties}>
            Open in mail app
          </button>
          <button aria-label="Action" type="button" disabled={busy} onClick={() => send(false)} style={{ ...S.btn as React.CSSProperties, opacity: busy ? 0.6 : 1 }}>
            {busy ? "Sending…" : "Send email"}
          </button>
        </div>

        <p style={{ fontSize: 14, color: T.text3, marginTop: 12, marginBottom: 0 }}>
          Sends via Resend when <code>RESEND_API_KEY</code> is configured on the server; otherwise opens your mail app and logs the message.
        </p>
      </div>
    </div>
  );
}
