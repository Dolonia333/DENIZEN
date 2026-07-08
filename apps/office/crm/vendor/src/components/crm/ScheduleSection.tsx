/**
 * CONSOLIDATED: Schedule section merges Schedule + Calendar + Activity (Interactions)
 * into a single sidebar entry with internal sub-tab navigation.
 */
import { useState, useEffect } from "react";
import { CRM_SUBNAV_EVENT, dispatchCrmSubNav } from "@/lib/crm-nav";
import { type Task, type Deal, type Meeting, type Contact, type Note } from "@/lib/crm-data";
import { SubTabNav } from "./shared/SubTabNav";
import { ScheduleTab } from "./ScheduleTab";
import { CalendarTab } from "./CalendarTab";
import { ActivityTab } from "./ActivityTab";

const SCHEDULE_TABS = [
  { key: "tasks", label: "Tasks & Meetings", icon: "📅" },
  { key: "calendar", label: "Calendar", icon: "📆" },
  { key: "interactions", label: "Interactions", icon: "◎" },
];

interface Props {
  tasks: Task[];
  deals: Deal[];
  meetings: Meeting[];
  contacts: Contact[];
  notes: Note[];
  availability: any;
  onToggleTask: (id: number) => void;
  onDeleteTask: (id: number) => void;
  onUpdateTask: (task: Task) => void;
  onAddMeeting: (m: Meeting) => void;
  onUpdateMeeting: (m: Meeting) => void;
  onDeleteNote: (id: number) => void;
  onNavigate: (id: string) => void;
  onCalendarSync?: () => void;
  initialTab?: string;
  onSubTabChange?: (subTab: string) => void;
}

export function ScheduleSection({
  tasks, deals, meetings, contacts, notes, availability,
  onToggleTask, onDeleteTask, onUpdateTask, onAddMeeting, onUpdateMeeting,
  onDeleteNote, onNavigate, onCalendarSync, initialTab, onSubTabChange,
}: Props) {
  const [activeTab, setActiveTab] = useState(initialTab || "tasks");

  const selectTab = (key: string) => {
    setActiveTab(key);
    onSubTabChange?.(key);
    dispatchCrmSubNav("schedule", key);
  };

  useEffect(() => {
    if (initialTab) setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    const onSubNav = (e: Event) => {
      const { tab, subTab } = (e as CustomEvent<{ tab: string; subTab: string }>).detail || {};
      if (tab === "schedule" && subTab) setActiveTab(subTab);
    };
    window.addEventListener(CRM_SUBNAV_EVENT, onSubNav);
    return () => window.removeEventListener(CRM_SUBNAV_EVENT, onSubNav);
  }, []);

  return (
    <div>
      <SubTabNav tabs={SCHEDULE_TABS} active={activeTab} onSelect={selectTab} />

      {activeTab === "tasks" && (
        <ScheduleTab
          tasks={tasks} deals={deals} meetings={meetings} contacts={contacts}
          availability={availability} onToggleTask={onToggleTask} onDeleteTask={onDeleteTask}
          onUpdateTask={onUpdateTask} onAddMeeting={onAddMeeting} onUpdateMeeting={onUpdateMeeting}
        />
      )}

      {activeTab === "calendar" && (
        <CalendarTab
          tasks={tasks} deals={deals} meetings={meetings} contacts={contacts}
          availability={availability} onNavigate={onNavigate}
          onAddMeeting={onAddMeeting} onUpdateMeeting={onUpdateMeeting}
          onCalendarSync={onCalendarSync}
        />
      )}

      {/* Renamed from "Activity" → "Interactions" for clarity — shows past calls/emails/meetings */}
      {activeTab === "interactions" && (
        <ActivityTab notes={notes} onDeleteNote={onDeleteNote} />
      )}
    </div>
  );
}
