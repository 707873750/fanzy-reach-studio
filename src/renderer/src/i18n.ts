import { useSyncExternalStore } from "react";
import messages from "./locales/messages.json";

export const LANGUAGES = [
  { code: "zh-CN", label: "简体中文" },
  { code: "en", label: "English" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" }
] as const;
export type Language = typeof LANGUAGES[number]["code"];
const storageKey = "fanzy-reach.ui-language";
const valid = (value: unknown): value is Language => LANGUAGES.some(item => item.code === value);
let language: Language = "zh-CN";
try { const saved = localStorage.getItem(storageKey); if (valid(saved)) language = saved; } catch { /* Storage may be unavailable. */ }
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useLanguage() { return useSyncExternalStore(subscribe, () => language); }
export function setLanguage(next: Language) {
  if (!valid(next)) return;
  language = next;
  document.documentElement.lang = next;
  try { localStorage.setItem(storageKey, next); } catch { /* Keep the selection for this session. */ }
  listeners.forEach(listener => listener());
}
document.documentElement.lang = language;
const dictionary: Record<string, string[]> = messages;
export function t(source: string, values: readonly unknown[] = []): string {
  const index = language === "en" ? 0 : language === "ja" ? 1 : language === "ko" ? 2 : -1;
  const translated = index < 0 ? source : dictionary[source]?.[index] ?? source;
  return translated.replace(/\{(\d+)\}/g, (token, index: string) => Number(index) < values.length ? String(values[Number(index)] ?? "") : token);
}
export function formatDate(value: string) { return new Date(value).toLocaleString(language); }
