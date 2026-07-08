import { useState, useEffect } from "react";

export function useMobile(bp = 768) {
  const [m, setM] = useState(() => typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const fn = () => setM(window.innerWidth < bp);
    window.addEventListener("resize", fn, { passive: true });
    fn();
    return () => window.removeEventListener("resize", fn);
  }, [bp]);
  return m;
}

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((prev: T) => T)) => void] {
  const [stored, setStored] = useState<T>(() => {
    try {
      const item = typeof window !== "undefined" ? window.localStorage.getItem("meridian_" + key) : null;
      return item ? JSON.parse(item) : initialValue;
    } catch { return initialValue; }
  });
  const setValue = (value: T | ((prev: T) => T)) => {
    try {
      setStored((prev) => {
        const v = typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
        if (typeof window !== "undefined") {
          window.localStorage.setItem("meridian_" + key, JSON.stringify(v));
        }
        return v;
      });
    } catch (e) { console.warn("localStorage write failed:", e); }
  };
  return [stored, setValue];
}
