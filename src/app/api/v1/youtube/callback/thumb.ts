export function pickThumbUrl(t?: { medium?: { url: string }; default?: { url: string } }): string | null {
  return t?.medium?.url ?? t?.default?.url ?? null;
}
