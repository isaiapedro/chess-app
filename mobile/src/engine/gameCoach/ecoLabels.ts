import { resolveEcoFamily, resolveFamilyByName } from "../ecoFamilies";

/**
 * Opening label for coach prose / metrics — same spirit as OpeningPrep `filtered`
 * selection `.name`: human opening name, never raw ECO codes.
 */
export function formatOpeningLabel(
  eco?: string | null,
  opening?: string | null
): string {
  const code = String(eco || "")
    .trim()
    .toUpperCase();
  const name = String(opening || "").trim();
  const nameIsEcoOnly = /^[A-E]\d{2}$/i.test(name);

  const byEco = resolveEcoFamily(code || null, name || null);
  const byName = resolveFamilyByName(nameIsEcoOnly ? null : name || null);

  // Prefer platform opening name / family name (OpeningPrep filtered.name).
  if (byName) return byName.name;
  if (name && !nameIsEcoOnly) {
    if (byEco) return byEco.name;
    return name;
  }
  if (byEco) return byEco.name;
  return "";
}
