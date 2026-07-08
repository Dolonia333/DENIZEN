import { useEffect, useState, useRef } from "react";
import { T, S, type Quota, TEAM_MEMBERS } from "@/lib/crm-data";

interface Props {
  quotas: Quota[];
}

interface Achievement {
  id: number;
  name: string;
  avatar: string;
  type: string;
  visible: boolean;
}

export function QuotaAchievementToast({ quotas }: Props) {
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const prevAchievedRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const currentAchieved = new Set(
      quotas.filter(q => q.currentValue >= q.targetValue).map(q => q.id)
    );

    // Find newly achieved quotas
    const newlyAchieved = quotas.filter(
      q => currentAchieved.has(q.id) && !prevAchievedRef.current.has(q.id)
    );

    if (newlyAchieved.length > 0 && prevAchievedRef.current.size > 0) {
      const newAchievements: Achievement[] = newlyAchieved.map(q => {
        const member = TEAM_MEMBERS.find(m => m.id === q.assigneeId);
        return {
          id: q.id,
          name: q.assigneeName,
          avatar: member?.avatar || "??",
          type: q.type,
          visible: true,
        };
      });

      setAchievements(prev => [...prev, ...newAchievements]);

      // Auto-dismiss after 4s
      setTimeout(() => {
        setAchievements(prev => prev.map(a =>
          newlyAchieved.some(q => q.id === a.id) ? { ...a, visible: false } : a
        ));
        setTimeout(() => {
          setAchievements(prev => prev.filter(a => a.visible));
        }, 400);
      }, 4000);
    }

    prevAchievedRef.current = currentAchieved;
  }, [quotas]);

  if (achievements.length === 0) return null;

  return (
    <div style={{
      position: "fixed", top: 20, right: 20, zIndex: 9999,
      display: "flex", flexDirection: "column", gap: 10, pointerEvents: "none",
    }}>
      {achievements.map(a => (
        <div
          key={`${a.id}-${a.name}`}
          style={{
            ...S.card as React.CSSProperties,
            padding: "16px 20px",
            display: "flex", alignItems: "center", gap: 14,
            background: `linear-gradient(135deg, ${T.bg2}, ${T.bg3})`,
            border: `1px solid #4d9ef744`,
            boxShadow: "0 8px 32px rgba(77,158,247,0.25)",
            minWidth: 300,
            opacity: a.visible ? 1 : 0,
            transform: a.visible ? "translateX(0) scale(1)" : "translateX(40px) scale(0.95)",
            transition: "all 0.4s cubic-bezier(0.4,0,0.2,1)",
            pointerEvents: "auto",
          }}
        >
          {/* Celebration icon */}
          <div style={{
            fontSize: 28,
            animation: "quota-celebrate 0.6s ease-out",
          }}>🎉</div>

          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: T.text0, marginBottom: 2 }}>
              Quota Achieved!
            </div>
            <div style={{ fontSize: 12, color: T.text2 }}>
              <span style={{ fontWeight: 600, color: "#4d9ef7" }}>{a.name}</span> hit their {a.type} target
            </div>
          </div>

          {/* Avatar */}
          <div style={{
            width: 36, height: 36, borderRadius: T.radius.full,
            background: "linear-gradient(135deg, #4d9ef7, #22d3a0)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 12, fontWeight: 700, color: "#fff",
            boxShadow: "0 0 16px rgba(77,158,247,0.4)",
          }}>{a.avatar}</div>
        </div>
      ))}

      <style>{`
        @keyframes quota-celebrate {
          0% { transform: scale(0) rotate(-20deg); }
          50% { transform: scale(1.3) rotate(10deg); }
          100% { transform: scale(1) rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
