const normalise = (locale: string): string => locale.toLowerCase().replaceAll("_", "-");

/**
 * Returns the configured Locale that a page's declared language names, spelled
 * the way the configuration spells it.
 *
 * The page's and the configuration's spellings are the same Locale to a
 * browser and a reader, and different strings to a store: used verbatim, the
 * page's spelling would open a row the configuration does not have and save
 * into it. Matching ignores case and treats underscore and hyphen as the same,
 * and nothing looser: a bare language does not match a regional variant,
 * because guessing a region would write to a Locale the page never showed. A
 * value that matches nothing comes back unchanged so the caller can still name
 * it.
 */
export function resolveLocale(declared: string, locales: readonly string[]): string {
  const wanted = normalise(declared);
  return locales.find((locale) => normalise(locale) === wanted) ?? declared;
}
