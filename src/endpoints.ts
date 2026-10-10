/** The literal placeholder that stands for the translation key in an endpoint template. */
export const KEY_PLACEHOLDER = "{key}";

/**
 * Fills an endpoint template for one key: the URL-encoded key replaces the
 * `{key}` placeholder and nothing else changes. The Developer owns the whole
 * URL, so nothing is prefixed, appended or guessed; a template without the
 * placeholder comes back as it is.
 */
export function resolveEndpoint(template: string, key: string): string {
  return template.split(KEY_PLACEHOLDER).join(encodeURIComponent(key));
}
