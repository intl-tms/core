// Pure text utilities that decide what the editing flow may do with a message.

const TAG_TOKEN = /<(\/?)([A-Za-z][A-Za-z0-9_-]*)([^>]*)>/g;

/**
 * The distinct, sorted tag names of a message.
 *
 * A tag in a message is a contract with the website's code: the code supplies
 * a handler for each tag name. A name counts only where it is really markup:
 * an opening tag with a matching closing tag, or a self-closing tag. A lone
 * `<Enter>` is prose ("Press <Enter> to continue"), and a comparison such as
 * "5 < 6" is never a tag because a name must begin with a letter.
 */
export function tagNames(message: string): string[] {
  const opened = new Set<string>();
  const closed = new Set<string>();
  const names = new Set<string>();
  for (const match of message.matchAll(TAG_TOKEN)) {
    const name = match[2]!;
    if (match[1] === "/") closed.add(name);
    else if (match[3]!.endsWith("/")) names.add(name);
    else opened.add(name);
  }
  for (const name of opened) if (closed.has(name)) names.add(name);
  return [...names].sort();
}

/**
 * Whether a message has any tag names, meaning it renders across several DOM
 * nodes rather than as one string.
 */
export function hasTags(message: string): boolean {
  return tagNames(message).length > 0;
}

/**
 * Whether the website's formatter would output `message` unchanged, so a saved
 * value can be written straight into the live page.
 *
 * The test is conservative by design. Calling a Plain message non-plain costs
 * one page reload; the reverse would put formatter source text in front of the
 * Editor. It therefore asks whether the value contains anything the formatter
 * could act on (a brace, an angle bracket, an apostrophe sequence that is an
 * escape), not whether it would.
 */
export function isPlain(message: string): boolean {
  return !/[{}<]/.test(message) && !message.includes("''") && !message.includes("'>");
}

/**
 * Why `draft` cannot be saved against `reference`, or `undefined` when it can.
 *
 * Tags are a contract with the website's code, and an i18n library typically
 * answers a broken tag by discarding the translation and rendering the source
 * Locale with the tags as literal markup, while the page still answers
 * successfully. Nothing announces it, so this guard stops it at the keyboard.
 *
 * Only tag names are compared: rewording, reordering and changing what sits
 * between tags are the translator's job. An empty reference skips the check
 * (there is nothing to compare against and guessing is worse), and so does an
 * empty draft (a cleared field is different from a broken tag).
 */
export function tagMismatch(draft: string, reference: string): string | undefined {
  if (draft === "" || reference === "") return undefined;
  const expected = new Set(tagNames(reference));
  const actual = new Set(tagNames(draft));
  const unknown = [...actual].filter((name) => !expected.has(name));
  const missing = [...expected].filter((name) => !actual.has(name));
  if (unknown.length === 0 && missing.length === 0) return undefined;
  const parts: string[] = [];
  if (unknown.length > 0) parts.push(`unknown ${unknown.map((n) => `<${n}>`).join(", ")}`);
  if (missing.length > 0) parts.push(`missing ${missing.map((n) => `<${n}>`).join(", ")}`);
  return `Tags must match the source: ${parts.join("; ")}`;
}

/** The notice a panel shows for a Shared translation. */
export const SHARED_NOTICE = "This text may appear in more than one place.";

/**
 * Whether a key is a Shared translation: one the Developer has named as meant
 * for more than one place. The rule is by name alone and tests only the start
 * of the key, so the prefix appearing in a later segment does not count.
 * Whether the key really is used in several places is not checked.
 */
export function isSharedKey(key: string): boolean {
  return key.startsWith("shared");
}
