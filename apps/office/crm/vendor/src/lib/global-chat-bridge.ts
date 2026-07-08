export interface SharedCard {
  title: string;
  type: "lead" | "deal" | "chart" | "note" | "task";
  color: string;
  snapshot: Record<string, string>;
  status?: string;
  notes?: string;
}

export function shareToGlobalChat(card: SharedCard) {
  window.dispatchEvent(new CustomEvent("share-to-global-chat", { detail: card }));
}
