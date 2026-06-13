import { useState, useMemo, useCallback, useRef, useEffect, type CSSProperties } from "react";
import { T, S, fmt, MEETING_TEMPLATES, type Task, type Deal, type Meeting, type Contact } from "@/lib/crm-data";
import {
  fetchCalendarStatus,
  calendarConnectUrl,
  syncExternalCalendar,
  type CalendarConnectionStatus,
} from "@/lib/crm-api";

interface Availability {
  timezone: string;
  workdays: number[];
  startHour: number;
  endHour: number;
  bufferTime: number;
  meetingTypes: { id: number; name: string; duration: number; description: string; color: string }[];
}

interface Props {
  tasks: Task[];
  deals: Deal[];
  meetings: Meeting[];
  contacts: Contact[];
  availability: Availability;
  onNavigate: (tab: string) => void;
  onAddMeeting: (meeting: Meeting) => void;
  onUpdateMeeting: (meeting: Meeting) => void;
  onCalendarSync?: () => void;
}

type ViewMode = "month" | "week" | "day" | "agenda" | "booking";

function generateICS(meeting: Meeting): string {
  const start = new Date(`${meeting.date}T${meeting.time}:00`);
  const end = new Date(start.getTime() + meeting.duration * 60000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//MeridianCRM//EN", "BEGIN:VEVENT",
    `DTSTART:${fmtDate(start)}`, `DTEND:${fmtDate(end)}`,
    `SUMMARY:${meeting.title}`, `DESCRIPTION:${(meeting.notes || "").replace(/\n/g, "\\n")}`,
    `LOCATION:${meeting.meetingUrl || ""}`,
    `STATUS:${meeting.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`,
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function downloadICS(meeting: Meeting) {
  const blob = new Blob([generateICS(meeting)], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${meeting.title.replace(/[^a-zA-Z0-9]/g, "_")}.ics`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const MEETING_TYPE_COLORS: Record<string, string> = {
  discovery: "#4d9ef7", demo: "#f0b429", proposal: "#8b5cf6", "check-in": "#22d3a0", other: "#fb923c",
};

function addMinutes(time: string, mins: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

// Heatmap colors by meeting count
function getHeatmapColor(count: number): string {
  if (count === 0) return "transparent";
  if (count <= 2) return "#f0b42910";
  if (count <= 4) return "#f0b42918";
  return "#ef444418";
}

export function CalendarTab({ tasks, deals, meetings, contacts, availability, onNavigate, onAddMeeting, onUpdateMeeting, onCalendarSync }: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dayViewDate, setDayViewDate] = useState(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`
  );
  const [showNewMeeting, setShowNewMeeting] = useState(false);
  const [showBookingPreview, setShowBookingPreview] = useState(false);
  const [editingMeeting, setEditingMeeting] = useState<Meeting | null>(null);

  // New meeting form state
  const [nmTitle, setNmTitle] = useState("");
  const [nmType, setNmType] = useState("discovery");
  const [nmDate, setNmDate] = useState("");
  const [nmTime, setNmTime] = useState("10:00");
  const [nmDuration, setNmDuration] = useState(30);
  const [nmContact, setNmContact] = useState("");
  const [nmNotes, setNmNotes] = useState("");
  const [nmUrl, setNmUrl] = useState("");
  const [nmRecurrence, setNmRecurrence] = useState<'none' | 'daily' | 'weekly' | 'monthly'>('none');
  const [nmChecklist, setNmChecklist] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestedSlots, setSuggestedSlots] = useState<{ date: string; time: string; reason: string }[]>([]);
  const [calStatus, setCalStatus] = useState<CalendarConnectionStatus | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [calMsg, setCalMsg] = useState<string | null>(null);

  const loadCalStatus = useCallback(() => {
    void fetchCalendarStatus().then(setCalStatus);
  }, []);

  useEffect(() => { loadCalStatus(); }, [loadCalStatus]);

  useEffect(() => {
    const hash = window.location.hash || "";
    const qIdx = hash.indexOf("?");
    if (qIdx < 0) return;
    const qs = new URLSearchParams(hash.slice(qIdx + 1));
    const provider = qs.get("calendar");
    if (qs.get("connected") === "1" && (provider === "google" || provider === "microsoft")) {
      setCalMsg(`${provider === "google" ? "Google" : "Microsoft"} Calendar connected`);
      void syncExternalCalendar(provider).then((r) => {
        if (r.ok) {
          setCalMsg(`Imported ${r.imported || 0} events`);
          onCalendarSync?.();
        }
        loadCalStatus();
      });
      window.history.replaceState(null, "", window.location.pathname + window.location.search + "#schedule");
    }
  }, [loadCalStatus, onCalendarSync]);

  const runSync = async (provider: "google" | "microsoft") => {
    setSyncing(provider);
    setCalMsg(null);
    const r = await syncExternalCalendar(provider);
    setSyncing(null);
    if (r.ok) {
      setCalMsg(`Imported ${r.imported || 0} new events`);
      onCalendarSync?.();
      loadCalStatus();
    } else {
      setCalMsg(r.error || "Sync failed");
    }
  };

  // Drag state for day/week view
  const [draggingMeeting, setDraggingMeeting] = useState<Meeting | null>(null);
  const [dragGhostTime, setDragGhostTime] = useState<string | null>(null);
  const [dragGhostDate, setDragGhostDate] = useState<string | null>(null);
  const dayViewRef = useRef<HTMLDivElement>(null);
  const weekViewRef = useRef<HTMLDivElement>(null);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay();
  const monthName = new Date(year, month).toLocaleString("default", { month: "long" });

  const prev = () => { setSelectedDate(null); if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const next = () => { setSelectedDate(null); if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  // Expand recurring meetings into visible instances
  const expandedMeetings = useMemo(() => {
    const result: Meeting[] = [];
    const viewStart = new Date(year, month, 1);
    const viewEnd = new Date(year, month + 1, 0);

    meetings.forEach(m => {
      if (!m.recurrence || m.recurrence === 'none') {
        result.push(m);
        return;
      }
      const mDate = new Date(m.date + "T12:00:00");
      let current = new Date(mDate);
      for (let i = 0; i < 90; i++) {
        if (current > viewEnd) break;
        if (current >= viewStart) {
          const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, "0")}-${String(current.getDate()).padStart(2, "0")}`;
          if (dateStr === m.date) {
            result.push(m);
          } else {
            result.push({ ...m, id: m.id * 10000 + i, date: dateStr, recurrenceParentId: m.id });
          }
        }
        if (m.recurrence === 'daily') current.setDate(current.getDate() + 1);
        else if (m.recurrence === 'weekly') current.setDate(current.getDate() + 7);
        else if (m.recurrence === 'monthly') current.setMonth(current.getMonth() + 1);
      }
    });
    return result;
  }, [meetings, year, month]);

  // Build events map
  const eventsMap = useMemo(() => {
    const map: Record<string, { label: string; type: string; color: string; priority?: string; meeting?: Meeting }[]> = {};
    const add = (date: string, ev: typeof map[string][0]) => {
      if (!date) return;
      if (!map[date]) map[date] = [];
      map[date].push(ev);
    };
    tasks.forEach(t => {
      if (!t.done) {
        const isOverdue = t.due && new Date(t.due) < today;
        add(t.due, { label: t.title, type: isOverdue ? "overdue" : "task", color: isOverdue ? T.red : t.priority === "High" ? T.orange : T.blue, priority: t.priority });
      }
    });
    deals.filter(d => !["Closed Won", "Closed Lost"].includes(d.stage)).forEach(d => {
      add(d.closeDate, { label: `Close: ${d.title}`, type: "deal", color: T.accent });
    });
    expandedMeetings.forEach(m => {
      add(m.date, { label: `${m.time} ${m.title}`, type: "meeting", color: MEETING_TYPE_COLORS[m.type] || T.purple, meeting: m });
    });
    return map;
  }, [tasks, deals, expandedMeetings, today]);

  const selectedEvents = selectedDate ? eventsMap[selectedDate] || [] : [];

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const calCellBorder = (colIdx: number, isLastRow: boolean): CSSProperties => ({
    borderRight: colIdx < 6 ? `1px solid ${T.gridLine}` : "none",
    borderBottom: !isLastRow ? `1px solid ${T.gridLine}` : "none",
  });

  // Agenda items
  const agendaItems = useMemo(() => {
    const items: { date: string; label: string; type: string; color: string; time?: string; meeting?: Meeting }[] = [];
    const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
    Object.entries(eventsMap).filter(([d]) => d.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))
      .forEach(([date, evts]) => evts.forEach(ev => items.push({ date, ...ev, time: ev.meeting?.time })));
    return items;
  }, [eventsMap, year, month]);

  // Day view meetings
  const dayMeetings = useMemo(() => {
    return expandedMeetings.filter(m => m.date === dayViewDate).sort((a, b) => a.time.localeCompare(b.time));
  }, [expandedMeetings, dayViewDate]);

  // Meeting count per day (for heatmap)
  const meetingCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    expandedMeetings.forEach(m => { counts[m.date] = (counts[m.date] || 0) + 1; });
    return counts;
  }, [expandedMeetings]);

  const getBookingSlots = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    if (!availability.workdays.includes(d.getDay())) return [];
    const booked = expandedMeetings.filter(m => m.date === dateStr).map(m => ({ start: m.time, end: addMinutes(m.time, m.duration) }));
    const slots: string[] = [];
    for (let h = availability.startHour; h < availability.endHour; h++) {
      for (const m of [0, 30]) {
        const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
        const conflict = booked.some(b => time >= b.start && time < b.end);
        if (!conflict) slots.push(time);
      }
    }
    return slots;
  };

  const resetForm = () => {
    setNmTitle(""); setNmType("discovery"); setNmDate(""); setNmTime("10:00");
    setNmDuration(30); setNmContact(""); setNmNotes(""); setNmUrl("");
    setNmRecurrence('none'); setNmChecklist([]); setEditingMeeting(null);
    setShowSuggestions(false); setSuggestedSlots([]);
  };

  const openNewMeeting = (date?: string, time?: string) => {
    resetForm();
    if (date) setNmDate(date);
    if (time) setNmTime(time);
    setShowNewMeeting(true);
  };

  const openEditMeeting = (m: Meeting) => {
    setNmTitle(m.title); setNmType(m.type); setNmDate(m.date); setNmTime(m.time);
    setNmDuration(m.duration); setNmContact(m.contact); setNmNotes(m.notes); setNmUrl(m.meetingUrl);
    setNmRecurrence(m.recurrence || 'none'); setNmChecklist(m.checklist || []);
    setEditingMeeting(m); setShowNewMeeting(true);
  };

  const saveMeeting = () => {
    if (!nmTitle || !nmDate || !nmTime) return;
    const meetingData: Meeting = {
      id: editingMeeting?.id || Date.now(),
      title: nmTitle, type: nmType, date: nmDate, time: nmTime,
      duration: nmDuration, contact: nmContact,
      attendees: nmContact ? [nmContact] : [],
      status: "confirmed", notes: nmNotes, meetingUrl: nmUrl,
      recurrence: nmRecurrence === 'none' ? undefined : nmRecurrence,
      checklist: nmChecklist.length > 0 ? nmChecklist : undefined,
    };
    if (editingMeeting) {
      onUpdateMeeting(meetingData);
    } else {
      onAddMeeting(meetingData);
    }
    setShowNewMeeting(false);
    resetForm();
  };

  const applyTemplate = (tpl: typeof MEETING_TEMPLATES[0]) => {
    setNmTitle(tpl.name);
    setNmType(tpl.type);
    setNmDuration(tpl.duration);
    setNmChecklist(tpl.checklist);
    setNmNotes(tpl.checklist.map((c, i) => `${i + 1}. ${c}`).join("\n"));
  };

  // Smart scheduling suggestions (mock AI)
  const generateSuggestions = () => {
    const targetDate = nmDate || dayViewDate || todayStr;
    const d = new Date(targetDate + "T12:00:00");
    const slots: { date: string; time: string; reason: string }[] = [];
    for (let offset = 0; offset < 7 && slots.length < 3; offset++) {
      const checkDate = new Date(d);
      checkDate.setDate(checkDate.getDate() + offset);
      if (!availability.workdays.includes(checkDate.getDay())) continue;
      const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, "0")}-${String(checkDate.getDate()).padStart(2, "0")}`;
      const available = getBookingSlots(dateStr);
      const preferred = available.filter(t => {
        const h = parseInt(t);
        return h >= 9 && h <= 16;
      });
      const pick = preferred.length > 0 ? preferred[Math.floor(preferred.length / 2)] : available[0];
      if (pick) {
        const dayName = checkDate.toLocaleDateString("en-US", { weekday: "short" });
        const meetingsOnDay = meetingCounts[dateStr] || 0;
        slots.push({
          date: dateStr, time: pick,
          reason: meetingsOnDay === 0 ? `${dayName} — No other meetings` :
                  meetingsOnDay <= 2 ? `${dayName} — Light schedule (${meetingsOnDay} meeting${meetingsOnDay > 1 ? "s" : ""})` :
                  `${dayName} — Open slot between meetings`,
        });
      }
    }
    setSuggestedSlots(slots);
    setShowSuggestions(true);
  };

  // Day view navigation
  const prevDay = () => {
    const d = new Date(dayViewDate + "T12:00:00");
    d.setDate(d.getDate() - 1);
    setDayViewDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };
  const nextDay = () => {
    const d = new Date(dayViewDate + "T12:00:00");
    d.setDate(d.getDate() + 1);
    setDayViewDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  };

  // Week view helpers
  const getWeekStart = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  };
  const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const weekDates = useMemo(() => {
    const start = getWeekStart(dayViewDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return toDateStr(d);
    });
  }, [dayViewDate]);

  const prevWeek = () => {
    const d = new Date(dayViewDate + "T12:00:00");
    d.setDate(d.getDate() - 7);
    setDayViewDate(toDateStr(d));
  };
  const nextWeek = () => {
    const d = new Date(dayViewDate + "T12:00:00");
    d.setDate(d.getDate() + 7);
    setDayViewDate(toDateStr(d));
  };

  const weekMeetings = useMemo(() => {
    const dateSet = new Set(weekDates);
    return expandedMeetings.filter(m => dateSet.has(m.date));
  }, [expandedMeetings, weekDates]);

  // Drag handlers for day/week view
  const handleDragStart = (e: React.DragEvent, meeting: Meeting) => {
    setDraggingMeeting(meeting);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(meeting.id));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (!dayViewRef.current) return;
    const rect = dayViewRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top + dayViewRef.current.scrollTop;
    const hourHeight = 60;
    const totalMinutes = Math.max(0, Math.round((y / hourHeight) * 60));
    const snapped = Math.round(totalMinutes / 15) * 15;
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    setDragGhostTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const handleWeekDragOver = (e: React.DragEvent, dateStr: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragGhostDate(dateStr);
    if (!weekViewRef.current) return;
    const col = (e.target as HTMLElement).closest('[data-week-col]');
    const container = weekViewRef.current;
    const rect = container.getBoundingClientRect();
    const y = e.clientY - rect.top + container.scrollTop;
    const hourHeight = 60;
    const totalMinutes = Math.max(0, Math.round((y / hourHeight) * 60));
    const snapped = Math.round(totalMinutes / 15) * 15;
    const h = Math.floor(snapped / 60);
    const m = snapped % 60;
    setDragGhostTime(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggingMeeting && dragGhostTime) {
      const real = draggingMeeting.recurrenceParentId
        ? meetings.find(m => m.id === draggingMeeting.recurrenceParentId) || draggingMeeting
        : draggingMeeting;
      const dropDate = dragGhostDate || dayViewDate;
      onUpdateMeeting({ ...real, time: dragGhostTime, date: dropDate });
    }
    setDraggingMeeting(null);
    setDragGhostTime(null);
    setDragGhostDate(null);
  };

  const handleDragEnd = () => {
    setDraggingMeeting(null);
    setDragGhostTime(null);
    setDragGhostDate(null);
  };

  const bookingLink = `${window.location.origin}/?book=true`;
  const copyBookingLink = () => { navigator.clipboard.writeText(bookingLink); };

  const HOURS = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div>
      {(calStatus?.googleConfigured || calStatus?.microsoftConfigured) && (
        <div style={{
          marginBottom: 16, padding: "14px 16px", borderRadius: 12,
          background: `${T.blue}10`, border: `1px solid ${T.blue}33`,
          display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center",
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: T.text1 }}>External calendars</span>
          {calStatus?.googleConfigured && (
            <button
              type="button"
              onClick={() => {
                if (calStatus.google.connected) void runSync("google");
                else window.location.href = calendarConnectUrl("google");
              }}
              disabled={syncing === "google"}
              style={{ ...S.btnGhost, fontSize: 11, padding: "6px 12px" }}
            >
              {calStatus.google.connected
                ? (syncing === "google" ? "Syncing Google…" : `Sync Google${calStatus.google.email ? ` (${calStatus.google.email})` : ""}`)
                : "Connect Google"}
            </button>
          )}
          {calStatus?.microsoftConfigured && (
            <button
              type="button"
              onClick={() => {
                if (calStatus.microsoft.connected) void runSync("microsoft");
                else window.location.href = calendarConnectUrl("microsoft");
              }}
              disabled={syncing === "microsoft"}
              style={{ ...S.btnGhost, fontSize: 11, padding: "6px 12px" }}
            >
              {calStatus.microsoft.connected
                ? (syncing === "microsoft" ? "Syncing Microsoft…" : `Sync Outlook${calStatus.microsoft.email ? ` (${calStatus.microsoft.email})` : ""}`)
                : "Connect Outlook"}
            </button>
          )}
          {calMsg && <span style={{ fontSize: 11, color: T.green }}>{calMsg}</span>}
        </div>
      )}

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: T.text0, margin: 0, letterSpacing: "-0.02em" }}>Calendar</h1>
          <p style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>Meetings, tasks, deals & booking</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {(["month", "week", "day", "agenda", "booking"] as ViewMode[]).map(v => (
            <button key={v} onClick={() => {
              setViewMode(v);
              if ((v === "day" || v === "week") && selectedDate) setDayViewDate(selectedDate);
            }} style={{
              ...S.btnGhost, fontSize: 12, padding: "6px 14px",
              background: viewMode === v ? T.accent : T.bg3, color: viewMode === v ? "#080d18" : T.text2,
              fontWeight: viewMode === v ? 700 : 500,
            }}>
              {v === "month" ? "📅 Month" : v === "week" ? "📆 Week" : v === "day" ? "🕐 Day" : v === "agenda" ? "📋 Agenda" : "🔗 Booking"}
            </button>
          ))}
          <button onClick={() => openNewMeeting(selectedDate || dayViewDate || todayStr)} style={{ ...S.btn, fontSize: 12, padding: "6px 14px" }}>+ Meeting</button>
        </div>
      </div>

      {/* ── MONTH VIEW ── */}
      {viewMode === "month" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 14 }}>
          <div style={{ ...S.card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <button onClick={prev} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "6px 12px", color: T.text2, cursor: "pointer", fontSize: 13 }}>←</button>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>{monthName} {year}</div>
              <button onClick={next} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "6px 12px", color: T.text2, cursor: "pointer", fontSize: 13 }}>→</button>
            </div>

            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", border: `1px solid ${T.gridLine}`, borderRadius: T.radius.md, overflow: "hidden" }}>
              <thead>
                <tr>
                  {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                    <th key={d} style={{
                      textAlign: "center", fontSize: 10, color: T.text2, fontWeight: 600,
                      padding: "8px 0", textTransform: "uppercase", letterSpacing: "0.06em",
                      borderBottom: `1px solid ${T.gridLineStrong}`,
                      borderRight: i < 6 ? `1px solid ${T.gridLine}` : "none",
                      background: T.bg3,
                    }}>{d}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: Math.ceil(cells.length / 7) }, (_, rowIdx) => {
                  const isLastRow = rowIdx === Math.ceil(cells.length / 7) - 1;
                  return (
                    <tr key={rowIdx}>
                      {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((day, colIdx) => {
                        if (day === null) {
                          return (
                            <td key={`e-${colIdx}`} style={{
                              height: 72, ...calCellBorder(colIdx, isLastRow),
                              background: "rgba(255,255,255,0.02)",
                            }} />
                          );
                        }
                        const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                        const events = eventsMap[dateStr] || [];
                        const isToday = dateStr === todayStr;
                        const isSelected = dateStr === selectedDate;
                        const mc = meetingCounts[dateStr] || 0;
                        return (
                          <td key={dateStr}
                            onClick={() => setSelectedDate(dateStr === selectedDate ? null : dateStr)}
                            onDoubleClick={() => { setDayViewDate(dateStr); setViewMode("day"); }}
                            style={{
                              height: 72, padding: "6px 8px", verticalAlign: "top",
                              cursor: "pointer", position: "relative", transition: "background 0.1s",
                              background: isSelected ? `${T.accent}22` : isToday ? `${T.blue}15` : getHeatmapColor(mc),
                              ...calCellBorder(colIdx, isLastRow),
                            }}
                          >
                            <span style={{
                              fontSize: 12, fontWeight: isToday ? 800 : 500,
                              color: isToday ? T.blue : isSelected ? T.accent : T.text1,
                            }}>{day}</span>
                            {events.length > 0 && (
                              <div style={{ display: "flex", gap: 2, marginTop: 4, flexWrap: "wrap" }}>
                                {events.slice(0, 3).map((ev, j) => (
                                  <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: ev.color }} />
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Heatmap legend */}
            <div style={{ display: "flex", gap: 14, marginTop: 14, flexWrap: "wrap", justifyContent: "space-between" }}>
              <div style={{ display: "flex", gap: 10 }}>
                {[["Meeting", T.purple], ["Task", T.blue], ["Overdue", T.red], ["Deal", T.accent]].map(([l, c]) => (
                  <div key={l as string} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: T.text3 }}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: c as string }} />{l}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 9, color: T.text3 }}>Load:</span>
                {[["None", "transparent"], ["1-2", "#f0b42922"], ["3-4", "#f0b42955"], ["5+", "#f85b5b44"]].map(([l, c]) => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: T.text3 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 2, background: c, border: `1px solid ${T.bg4}` }} />{l}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right panel */}
          <div style={{ ...S.card }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: T.text0 }}>
                {selectedDate ? new Date(selectedDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "Select a date"}
              </div>
              {selectedDate && (
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setDayViewDate(selectedDate); setViewMode("day"); }} style={{ fontSize: 10, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 10px", color: T.blue, cursor: "pointer" }}>🕐 Day View</button>
                  <button onClick={() => openNewMeeting(selectedDate)} style={{ fontSize: 11, background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer" }}>+ Add</button>
                </div>
              )}
            </div>

            {!selectedDate && (
              <div style={{ padding: "40px 0", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>📅</div>
                <div style={{ fontSize: 12, color: T.text3 }}>Click a date to see events · Double-click for day view</div>
              </div>
            )}

            {selectedDate && selectedEvents.length === 0 && (
              <div style={{ padding: "30px 0", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>✨</div>
                <div style={{ fontSize: 12, color: T.text3 }}>Nothing scheduled</div>
                <button onClick={() => openNewMeeting(selectedDate)} style={{ ...S.btn, fontSize: 11, padding: "6px 14px", marginTop: 12 }}>Schedule a meeting</button>
              </div>
            )}

            {selectedEvents.map((ev, i) => (
              <div key={i} style={{
                display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
                background: `${ev.color}10`, border: `1px solid ${ev.color}22`,
                borderRadius: T.radius.md, marginBottom: 8, borderLeft: `3px solid ${ev.color}`, cursor: ev.meeting ? "pointer" : "default",
              }} onClick={() => ev.meeting && openEditMeeting(ev.meeting)}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: ev.color, flexShrink: 0, marginTop: 4 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 13, color: T.text1, fontWeight: 500 }}>{ev.label}</span>
                    {ev.meeting?.recurrence && ev.meeting.recurrence !== 'none' && (
                      <span style={{ fontSize: 10, color: T.purple }}>🔁</span>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3, marginTop: 2 }}>
                    {ev.type === "meeting" && ev.meeting ? `${ev.meeting.duration}min · ${ev.meeting.type} · ${ev.meeting.contact || "No contact"}` :
                     ev.type === "deal" ? "Deal closing" : ev.type === "overdue" ? "⚠ Overdue" : `${ev.priority || "Medium"} priority task`}
                  </div>
                  {ev.meeting && (
                    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                      <button onClick={(e) => { e.stopPropagation(); downloadICS(ev.meeting!); }}
                        style={{ fontSize: 10, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "3px 8px", color: T.blue, cursor: "pointer" }}>📥 .ics</button>
                      {ev.meeting.meetingUrl && (
                        <button onClick={(e) => { e.stopPropagation(); window.open(ev.meeting!.meetingUrl, "_blank"); }}
                          style={{ fontSize: 10, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "3px 8px", color: T.green, cursor: "pointer" }}>🔗 Join</button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── DAY VIEW ── */}
      {viewMode === "day" && (
        <div style={{ ...S.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={prevDay} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer", fontSize: 12 }}>←</button>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>
                {new Date(dayViewDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              </span>
              <button onClick={nextDay} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer", fontSize: 12 }}>→</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setDayViewDate(todayStr)} style={{ fontSize: 11, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 10px", color: T.blue, cursor: "pointer" }}>Today</button>
              <span style={{ fontSize: 12, color: T.text3 }}>{dayMeetings.length} meeting{dayMeetings.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          {/* 24-hour timeline */}
          <div ref={dayViewRef} style={{
            position: "relative", height: 720, overflowY: "auto", borderRadius: T.radius.md,
            border: `1px solid ${T.gridLine}`,
          }}
            onDragOver={handleDragOver} onDrop={handleDrop}>
            {HOURS.map(h => (
              <div key={h} style={{
                height: 60, display: "flex", borderTop: h === 0 ? "none" : `1px solid ${T.gridLine}`,
                cursor: "pointer", position: "relative",
              }} onClick={() => openNewMeeting(dayViewDate, `${String(h).padStart(2, "0")}:00`)}>
                <div style={{
                  width: 56, fontSize: 10, color: T.text3, fontFamily: "'JetBrains Mono', monospace",
                  paddingTop: 2, textAlign: "right", paddingRight: 8, flexShrink: 0,
                  borderRight: `1px solid ${T.gridLineStrong}`,
                }}>
                  {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                </div>
                <div style={{ flex: 1, borderLeft: `1px solid ${T.gridLine}` }} />
              </div>
            ))}

            {/* Meeting blocks */}
            {dayMeetings.map(m => {
              const topMin = timeToMinutes(m.time);
              const color = MEETING_TYPE_COLORS[m.type] || T.purple;
              const isDragging = draggingMeeting?.id === m.id;
              return (
                <div key={m.id} draggable onDragStart={(e) => handleDragStart(e, m)} onDragEnd={handleDragEnd}
                  onClick={(e) => { e.stopPropagation(); openEditMeeting(m); }}
                  style={{
                    position: "absolute", left: 64, right: 8,
                    top: topMin, height: Math.max(m.duration, 15),
                    background: `${color}22`, border: `1px solid ${color}55`,
                    borderLeft: `3px solid ${color}`,
                    borderRadius: T.radius.sm, padding: "4px 8px",
                    cursor: "grab", opacity: isDragging ? 0.4 : 1,
                    transition: "opacity 0.15s", zIndex: 10, overflow: "hidden",
                  }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: T.text0 }}>{m.title}</span>
                    {m.recurrence && m.recurrence !== 'none' && <span style={{ fontSize: 9 }}>🔁</span>}
                  </div>
                  <div style={{ fontSize: 10, color: T.text2 }}>
                    {m.time} – {addMinutes(m.time, m.duration)} · {m.contact || "No contact"}
                  </div>
                  <div style={{ position: "absolute", top: 4, right: 6, display: "flex", gap: 4 }}>
                    <button onClick={(e) => { e.stopPropagation(); downloadICS(m); }}
                      style={{ fontSize: 9, background: `${T.bg1}cc`, border: "none", borderRadius: 3, padding: "2px 5px", color: T.blue, cursor: "pointer" }}>📥</button>
                  </div>
                </div>
              );
            })}

            {/* Drag ghost preview */}
            {draggingMeeting && dragGhostTime && (
              <div style={{
                position: "absolute", left: 64, right: 8,
                top: timeToMinutes(dragGhostTime),
                height: Math.max(draggingMeeting.duration, 15),
                background: `${T.accent}15`, border: `2px dashed ${T.accent}66`,
                borderRadius: T.radius.sm, padding: "4px 8px",
                pointerEvents: "none", zIndex: 5,
              }}>
                <div style={{ fontSize: 11, color: T.accent, fontWeight: 600 }}>{dragGhostTime} — {draggingMeeting.title}</div>
              </div>
            )}

            {/* Current time indicator */}
            {dayViewDate === todayStr && (() => {
              const now = new Date();
              const mins = now.getHours() * 60 + now.getMinutes();
              return (
                <div style={{ position: "absolute", left: 50, right: 0, top: mins, height: 2, background: T.red, zIndex: 20 }}>
                  <div style={{ position: "absolute", left: -4, top: -4, width: 10, height: 10, borderRadius: "50%", background: T.red }} />
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── WEEK VIEW ── */}
      {viewMode === "week" && (
        <div style={{ ...S.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={prevWeek} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer", fontSize: 12 }}>←</button>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>
                {new Date(weekDates[0] + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })} – {new Date(weekDates[6] + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
              <button onClick={nextWeek} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer", fontSize: 12 }}>→</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => setDayViewDate(todayStr)} style={{ fontSize: 11, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "4px 10px", color: T.blue, cursor: "pointer" }}>This Week</button>
              <span style={{ fontSize: 12, color: T.text3 }}>{weekMeetings.length} meeting{weekMeetings.length !== 1 ? "s" : ""}</span>
            </div>
          </div>

          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", gap: 0, borderBottom: `1px solid ${T.gridLineStrong}` }}>
            <div style={{ borderRight: `1px solid ${T.gridLine}` }} />
            {weekDates.map((dateStr, i) => {
              const d = new Date(dateStr + "T12:00:00");
              const isToday = dateStr === todayStr;
              return (
                <div key={dateStr} style={{
                  textAlign: "center", padding: "8px 4px",
                  borderRight: i < 6 ? `1px solid ${T.gridLine}` : "none",
                  background: isToday ? `${T.blue}10` : "transparent",
                }}>
                  <div style={{ fontSize: 10, color: T.text3, fontWeight: 600, textTransform: "uppercase" }}>
                    {d.toLocaleDateString("en-US", { weekday: "short" })}
                  </div>
                  <div style={{
                    fontSize: 16, fontWeight: isToday ? 800 : 500,
                    color: isToday ? T.blue : T.text1,
                    cursor: "pointer",
                  }} onClick={() => { setDayViewDate(dateStr); setViewMode("day"); }}>
                    {d.getDate()}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div ref={weekViewRef} style={{
            position: "relative", height: 720, overflowY: "auto",
            border: `1px solid ${T.gridLine}`, borderTop: "none", borderRadius: `0 0 ${T.radius.md}px ${T.radius.md}px`,
          }} onDrop={handleDrop}>
            <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", gap: 0 }}>
              {HOURS.map(h => (
                <div key={h} style={{ display: "contents" }}>
                  <div style={{
                    height: 60, fontSize: 10, color: T.text3,
                    fontFamily: "'JetBrains Mono', monospace", paddingTop: 2,
                    textAlign: "right", paddingRight: 8,
                    borderTop: h === 0 ? "none" : `1px solid ${T.gridLine}`,
                    borderRight: `1px solid ${T.gridLineStrong}`,
                  }}>
                    {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
                  </div>
                  {weekDates.map((dateStr, colIdx) => (
                    <div key={`${h}-${dateStr}`} data-week-col={dateStr}
                      onDragOver={(e) => handleWeekDragOver(e, dateStr)}
                      onClick={() => openNewMeeting(dateStr, `${String(h).padStart(2, "0")}:00`)}
                      style={{
                        height: 60,
                        borderTop: h === 0 ? "none" : `1px solid ${T.gridLine}`,
                        borderLeft: `1px solid ${T.gridLine}`,
                        borderRight: colIdx < 6 ? "none" : undefined,
                        cursor: "pointer", position: "relative",
                        background: dateStr === todayStr ? `${T.blue}05` : "transparent",
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Meeting blocks overlaid per column */}
            {weekDates.map((dateStr, colIdx) => {
              const colMeetings = weekMeetings.filter(m => m.date === dateStr);
              const colLeft = `calc(56px + ${colIdx} * ((100% - 56px) / 7))`;
              const colWidth = `calc((100% - 56px) / 7)`;
              return colMeetings.map(m => {
                const topMin = timeToMinutes(m.time);
                const color = MEETING_TYPE_COLORS[m.type] || T.purple;
                const isDragging = draggingMeeting?.id === m.id;
                return (
                  <div key={m.id} draggable onDragStart={(e) => handleDragStart(e, m)} onDragEnd={handleDragEnd}
                    onClick={(e) => { e.stopPropagation(); openEditMeeting(m); }}
                    style={{
                      position: "absolute", left: colLeft, width: colWidth,
                      top: topMin, height: Math.max(m.duration, 15),
                      background: `${color}22`, border: `1px solid ${color}55`,
                      borderLeft: `3px solid ${color}`,
                      borderRadius: T.radius.sm, padding: "2px 6px",
                      cursor: "grab", opacity: isDragging ? 0.4 : 1,
                      transition: "opacity 0.15s", zIndex: 10, overflow: "hidden",
                      boxSizing: "border-box",
                    }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: T.text0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {m.title}
                      {m.recurrence && m.recurrence !== 'none' && <span style={{ marginLeft: 3, fontSize: 8 }}>🔁</span>}
                    </div>
                    {m.duration >= 30 && (
                      <div style={{ fontSize: 9, color: T.text2 }}>
                        {m.time} · {m.contact || ""}
                      </div>
                    )}
                  </div>
                );
              });
            })}

            {/* Drag ghost for week view */}
            {draggingMeeting && dragGhostTime && dragGhostDate && weekDates.includes(dragGhostDate) && (() => {
              const colIdx = weekDates.indexOf(dragGhostDate);
              return (
                <div style={{
                  position: "absolute",
                  left: `calc(56px + ${colIdx} * ((100% - 56px) / 7))`,
                  width: `calc((100% - 56px) / 7)`,
                  top: timeToMinutes(dragGhostTime),
                  height: Math.max(draggingMeeting.duration, 15),
                  background: `${T.accent}15`, border: `2px dashed ${T.accent}66`,
                  borderRadius: T.radius.sm, padding: "2px 6px",
                  pointerEvents: "none", zIndex: 5, boxSizing: "border-box",
                }}>
                  <div style={{ fontSize: 10, color: T.accent, fontWeight: 600 }}>{dragGhostTime}</div>
                </div>
              );
            })()}

            {/* Current time indicator */}
            {weekDates.includes(todayStr) && (() => {
              const now = new Date();
              const mins = now.getHours() * 60 + now.getMinutes();
              const colIdx = weekDates.indexOf(todayStr);
              return (
                <div style={{
                  position: "absolute",
                  left: `calc(56px + ${colIdx} * ((100% - 56px) / 7))`,
                  width: `calc((100% - 56px) / 7)`,
                  top: mins, height: 2, background: T.red, zIndex: 20,
                }}>
                  <div style={{ position: "absolute", left: -4, top: -4, width: 10, height: 10, borderRadius: "50%", background: T.red }} />
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── AGENDA VIEW ── */}
      {viewMode === "agenda" && (
        <div style={{ ...S.card }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <button onClick={prev} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer", fontSize: 12 }}>←</button>
              <span style={{ fontSize: 15, fontWeight: 700, color: T.text0 }}>{monthName} {year}</span>
              <button onClick={next} style={{ background: T.bg4, border: "none", borderRadius: T.radius.sm, padding: "4px 10px", color: T.text2, cursor: "pointer", fontSize: 12 }}>→</button>
            </div>
            <div style={{ fontSize: 12, color: T.text3 }}>{agendaItems.length} events</div>
          </div>

          {agendaItems.length === 0 && (
            <div style={{ padding: "50px 0", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>📋</div>
              <div style={{ fontSize: 13, color: T.text3 }}>No events this month</div>
            </div>
          )}

          {(() => {
            let lastDate = "";
            return agendaItems.map((item, i) => {
              const showDate = item.date !== lastDate;
              lastDate = item.date;
              const dateObj = new Date(item.date + "T12:00:00");
              const isPast = item.date < todayStr;
              return (
                <div key={i}>
                  {showDate && (
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: item.date === todayStr ? T.blue : T.text3,
                      textTransform: "uppercase", letterSpacing: "0.06em", padding: "14px 0 6px",
                      borderTop: i > 0 ? `1px solid ${T.bg4}` : "none",
                    }}>
                      {item.date === todayStr ? "📍 Today" : dateObj.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </div>
                  )}
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "8px 12px",
                    background: `${item.color}08`, borderLeft: `3px solid ${item.color}`,
                    borderRadius: T.radius.sm, marginBottom: 4, opacity: isPast ? 0.5 : 1,
                    cursor: item.meeting ? "pointer" : "default",
                  }} onClick={() => item.meeting && openEditMeeting(item.meeting)}>
                    <div style={{ width: 6, height: 6, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                    {item.time && <span style={{ fontSize: 11, fontWeight: 700, color: T.text2, fontFamily: "'JetBrains Mono', monospace", width: 40 }}>{item.time}</span>}
                    <span style={{ fontSize: 12, color: T.text1, flex: 1 }}>{item.label}</span>
                    {item.meeting?.recurrence && item.meeting.recurrence !== 'none' && <span style={{ fontSize: 10 }}>🔁</span>}
                    <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: T.radius.xs, background: `${item.color}18`, color: item.color, fontWeight: 600 }}>{item.type}</span>
                    {item.meeting && (
                      <button onClick={(e) => { e.stopPropagation(); downloadICS(item.meeting!); }}
                        style={{ fontSize: 10, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "3px 7px", color: T.blue, cursor: "pointer" }}>📥</button>
                    )}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {/* ── BOOKING VIEW ── */}
      {viewMode === "booking" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ ...S.card }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text0, marginBottom: 16 }}>🔗 Booking Page</div>
            <div style={{ ...S.label }}>Your Booking Link</div>
            <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
              <div style={{ flex: 1, ...S.input, fontSize: 11, color: T.text2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{bookingLink}</div>
              <button onClick={copyBookingLink} style={{ ...S.btn, fontSize: 11, padding: "8px 14px", whiteSpace: "nowrap" }}>📋 Copy</button>
            </div>
            <div style={{ ...S.label }}>Working Hours</div>
            <div style={{ fontSize: 13, color: T.text1, marginBottom: 6 }}>{availability.startHour}:00 – {availability.endHour}:00 ({availability.timezone})</div>
            <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
                <div key={d} style={{
                  fontSize: 10, padding: "4px 8px", borderRadius: T.radius.xs, fontWeight: 600,
                  background: availability.workdays.includes(i) ? `${T.green}22` : T.bg4,
                  color: availability.workdays.includes(i) ? T.green : T.text3,
                  border: `1px solid ${availability.workdays.includes(i) ? T.green + "44" : T.bg5}`,
                }}>{d}</div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: T.text3, marginBottom: 20 }}>Buffer: {availability.bufferTime} min between meetings</div>
            <div style={{ ...S.label }}>Meeting Types</div>
            {availability.meetingTypes.map(mt => (
              <div key={mt.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                background: `${mt.color}10`, border: `1px solid ${mt.color}22`,
                borderRadius: T.radius.md, marginBottom: 6, borderLeft: `3px solid ${mt.color}`,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: T.text1, fontWeight: 600 }}>{mt.name}</div>
                  <div style={{ fontSize: 11, color: T.text3 }}>{mt.duration} min · {mt.description}</div>
                </div>
              </div>
            ))}
            <button onClick={() => setShowBookingPreview(true)} style={{ ...S.btnGhost, marginTop: 14, width: "100%", textAlign: "center", fontSize: 12 }}>
              👁 Preview Booking Page
            </button>
          </div>

          <div style={{ ...S.card }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text0, marginBottom: 16 }}>📅 Upcoming Meetings</div>
            {meetings.filter(m => m.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).length === 0 && (
              <div style={{ padding: "40px 0", textAlign: "center" }}>
                <div style={{ fontSize: 28, marginBottom: 8, opacity: 0.3 }}>📅</div>
                <div style={{ fontSize: 12, color: T.text3 }}>No upcoming meetings</div>
              </div>
            )}
            {meetings.filter(m => m.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).map(m => (
              <div key={m.id} onClick={() => openEditMeeting(m)} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                background: `${MEETING_TYPE_COLORS[m.type] || T.purple}08`,
                border: `1px solid ${T.bg4}`, borderRadius: T.radius.md, marginBottom: 6,
                cursor: "pointer", borderLeft: `3px solid ${MEETING_TYPE_COLORS[m.type] || T.purple}`,
              }}>
                <div style={{ minWidth: 58 }}>
                  <div style={{ fontSize: 10, color: T.text3, fontFamily: "'JetBrains Mono', monospace" }}>
                    {new Date(m.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: T.text1, fontFamily: "'JetBrains Mono', monospace" }}>{m.time}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ fontSize: 12, color: T.text1, fontWeight: 500 }}>{m.title}</span>
                    {m.recurrence && m.recurrence !== 'none' && <span style={{ fontSize: 9 }}>🔁</span>}
                  </div>
                  <div style={{ fontSize: 10, color: T.text3 }}>{m.duration}min · {m.contact}</div>
                </div>
                <div style={{ display: "flex", gap: 4 }}>
                  <button onClick={(e) => { e.stopPropagation(); downloadICS(m); }}
                    style={{ fontSize: 10, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "3px 7px", color: T.blue, cursor: "pointer" }}>📥</button>
                  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: T.radius.xs, background: m.status === "confirmed" ? `${T.green}18` : `${T.orange}18`, color: m.status === "confirmed" ? T.green : T.orange, fontWeight: 600 }}>{m.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NEW/EDIT MEETING MODAL ── */}
      {showNewMeeting && (
        <div style={S.modalBg} onClick={() => { setShowNewMeeting(false); resetForm(); }}>
          <div style={{ ...S.modalBox, width: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text0 }}>
                {editingMeeting ? "Edit Meeting" : "New Meeting"}
              </div>
              {/* Meeting templates */}
              {!editingMeeting && (
                <div style={{ display: "flex", gap: 4 }}>
                  {MEETING_TEMPLATES.map(tpl => (
                    <button key={tpl.name} onClick={() => applyTemplate(tpl)}
                      style={{ fontSize: 9, background: T.bg4, border: "none", borderRadius: T.radius.xs, padding: "3px 8px", color: T.accent, cursor: "pointer", whiteSpace: "nowrap" }}>
                      {tpl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div style={{ ...S.label }}>Title *</div>
            <input value={nmTitle} onChange={e => setNmTitle(e.target.value)} placeholder="e.g. Discovery Call — Acme Corp"
              style={{ ...S.input, marginBottom: 14 }} />

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ ...S.label }}>Type</div>
                <select value={nmType} onChange={e => setNmType(e.target.value)} style={{ ...S.input, marginBottom: 14 }}>
                  <option value="discovery">Discovery Call</option>
                  <option value="demo">Product Demo</option>
                  <option value="proposal">Proposal Review</option>
                  <option value="check-in">Check-in</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <div style={{ ...S.label }}>Duration (min)</div>
                <select value={nmDuration} onChange={e => setNmDuration(Number(e.target.value))} style={{ ...S.input, marginBottom: 14 }}>
                  {[15, 30, 45, 60, 90].map(d => <option key={d} value={d}>{d} min</option>)}
                </select>
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ ...S.label }}>Date *</div>
                <input type="date" value={nmDate} onChange={e => setNmDate(e.target.value)} style={{ ...S.input, marginBottom: 14 }} />
              </div>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ ...S.label }}>Time *</div>
                  <button onClick={generateSuggestions} style={{ fontSize: 9, background: "none", border: "none", color: T.purple, cursor: "pointer", fontWeight: 600 }}>✨ Suggest Times</button>
                </div>
                <input type="time" value={nmTime} onChange={e => setNmTime(e.target.value)} style={{ ...S.input, marginBottom: 14 }} />
              </div>
            </div>

            {/* Smart scheduling suggestions */}
            {showSuggestions && suggestedSlots.length > 0 && (
              <div style={{ marginBottom: 14, padding: 12, background: `${T.purple}10`, border: `1px solid ${T.purple}22`, borderRadius: T.radius.md }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: T.purple, marginBottom: 8 }}>✨ AI Suggested Times</div>
                {suggestedSlots.map((slot, i) => (
                  <button key={i} onClick={() => { setNmDate(slot.date); setNmTime(slot.time); setShowSuggestions(false); }}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%",
                      padding: "8px 10px", background: T.bg3, border: `1px solid ${T.bg4}`,
                      borderRadius: T.radius.sm, marginBottom: 4, cursor: "pointer", textAlign: "left",
                    }}>
                    <div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.text0, fontFamily: "'JetBrains Mono', monospace" }}>{slot.time}</span>
                      <span style={{ fontSize: 11, color: T.text2, marginLeft: 8 }}>
                        {new Date(slot.date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                      </span>
                    </div>
                    <span style={{ fontSize: 10, color: T.text3 }}>{slot.reason}</span>
                  </button>
                ))}
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <div>
                <div style={{ ...S.label }}>Contact</div>
                <select value={nmContact} onChange={e => setNmContact(e.target.value)} style={{ ...S.input, marginBottom: 14 }}>
                  <option value="">— Select contact —</option>
                  {contacts.map(c => <option key={c.id} value={c.name}>{c.name} ({c.company})</option>)}
                </select>
              </div>
              <div>
                <div style={{ ...S.label }}>Recurring</div>
                <select value={nmRecurrence} onChange={e => setNmRecurrence(e.target.value as any)} style={{ ...S.input, marginBottom: 14 }}>
                  <option value="none">No repeat</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>

            <div style={{ ...S.label }}>Meeting URL</div>
            <input value={nmUrl} onChange={e => setNmUrl(e.target.value)} placeholder="https://meet.google.com/..."
              style={{ ...S.input, marginBottom: 14 }} />

            <div style={{ ...S.label }}>Notes</div>
            <textarea value={nmNotes} onChange={e => setNmNotes(e.target.value)} placeholder="Meeting agenda..."
              style={{ ...S.input, minHeight: 60, resize: "vertical", marginBottom: 14 }} />

            {/* Checklist */}
            {nmChecklist.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ ...S.label }}>Checklist / Talking Points</div>
                {nmChecklist.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
                    <span style={{ fontSize: 10, color: T.text3, fontFamily: "'JetBrains Mono', monospace", width: 16 }}>{i + 1}.</span>
                    <span style={{ fontSize: 12, color: T.text1, flex: 1 }}>{item}</span>
                    <button onClick={() => setNmChecklist(prev => prev.filter((_, j) => j !== i))}
                      style={{ fontSize: 10, background: "none", border: "none", color: T.text3, cursor: "pointer" }}>×</button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              {editingMeeting && (
                <button onClick={(e) => { e.stopPropagation(); downloadICS(editingMeeting); }}
                  style={{ ...S.btnGhost, fontSize: 12 }}>📥 Download .ics</button>
              )}
              <button onClick={() => { setShowNewMeeting(false); resetForm(); }} style={{ ...S.btnGhost, fontSize: 12 }}>Cancel</button>
              <button onClick={saveMeeting} style={{ ...S.btn, fontSize: 12 }}>{editingMeeting ? "Save Changes" : "Create Meeting"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── BOOKING PAGE PREVIEW MODAL ── */}
      {showBookingPreview && (
        <div style={S.modalBg} onClick={() => setShowBookingPreview(false)}>
          <div style={{ ...S.modalBox, width: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📅</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: T.text0 }}>Book a Meeting</div>
              <div style={{ fontSize: 13, color: T.text2, marginTop: 4 }}>Choose a meeting type and pick a time</div>
            </div>
            {availability.meetingTypes.map(mt => (
              <div key={mt.id} style={{
                display: "flex", alignItems: "center", gap: 14, padding: "14px 16px",
                background: `${mt.color}08`, border: `1px solid ${mt.color}22`,
                borderRadius: T.radius.md, marginBottom: 8, cursor: "pointer", borderLeft: `4px solid ${mt.color}`,
              }}>
                <div style={{ width: 10, height: 10, borderRadius: "50%", background: mt.color }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, color: T.text0, fontWeight: 600 }}>{mt.name}</div>
                  <div style={{ fontSize: 12, color: T.text3 }}>{mt.duration} min · {mt.description}</div>
                </div>
                <div style={{ fontSize: 11, color: mt.color, fontWeight: 600 }}>Select →</div>
              </div>
            ))}
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <button onClick={() => setShowBookingPreview(false)} style={{ ...S.btnGhost, fontSize: 12 }}>Close Preview</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
