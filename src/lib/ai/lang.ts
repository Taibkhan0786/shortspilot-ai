/** Tiny script-based language detection (enough to pick the right TTS voice / caption font). */
export const DEVANAGARI_RE = /[\u0900-\u097F]/;

export function detectLang(text: string): "hi" | "en" {
  const letters = text.replace(/[\s\d\p{P}]/gu, "");
  if (!letters) return "en";
  const dev = (letters.match(/[\u0900-\u097F]/g) ?? []).length;
  return dev / letters.length > 0.3 ? "hi" : "en";
}
