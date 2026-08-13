import { resolveEcoFamily, resolveFamilyByName } from "../ecoFamilies";

/**
 * Compact opening system label from ECO family groups.
 * Never dump the full Lichess/Chess.com opening name.
 */
export function formatOpeningLabel(
  eco?: string | null,
  opening?: string | null
): string {
  const code = String(eco || "")
    .trim()
    .toUpperCase();
  const name = String(opening || "").trim();

  const byEco = resolveEcoFamily(code || null, name || null);
  if (byEco) return byEco.name;

  const byName = resolveFamilyByName(name || null);
  if (byName) return byName.name;

  if (code && /^[A-E]\d{2}$/i.test(code)) return code;
  return "";
}
