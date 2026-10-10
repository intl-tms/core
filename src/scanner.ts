// Finds every marked translation under a root. It never decodes a Marker
// itself: there is one decoder in the system, and it lives in the codec.

import { decode, detect, strip } from "./codec.js";

/** A translation found as the text of an element. */
export interface FoundText {
  kind: "text";
  /**
   * Stable across rescans for as long as the node survives, so a selection or
   * a list item can be addressed by it instead of by position.
   */
  id: string;
  element: Element;
  node: Text;
  key: string;
  /** The text with every Marker removed. */
  value: string;
}

/** A translation found in an element's attribute (a Hidden translation). */
export interface FoundAttribute {
  kind: "attribute";
  /** Stable across rescans for as long as the element survives. */
  id: string;
  element: Element;
  attribute: string;
  key: string;
  value: string;
}

/** A marked translation found on the page. */
export type Found = FoundText | FoundAttribute;

// Elements whose text never renders: it cannot be highlighted, and it would produce bogus usage.
const NEVER_RENDERED = new Set(["head", "title", "meta", "script", "style", "noscript"]);

const identities = new WeakMap<Node, number>();
let nextIdentity = 1;

/** A number for a node that stays the same for as long as the node exists. */
function identityOf(node: Node): number {
  let id = identities.get(node);
  if (id === undefined) identities.set(node, (id = nextIdentity++));
  return id;
}

// DOM constants, spelled out so the module needs no global NodeFilter.
const SHOW_ELEMENT = 0x1;
const SHOW_TEXT = 0x4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;
const FILTER_SKIP = 3;

function scanText(root: Document | Element): FoundText[] {
  const found: FoundText[] = [];
  if (root.nodeType === 1 && NEVER_RENDERED.has((root as Element).localName)) return found;
  const owner = root.nodeType === 9 ? (root as Document) : (root.ownerDocument as Document);
  const walker = owner.createTreeWalker(root, SHOW_ELEMENT | SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === 1) return NEVER_RENDERED.has((node as Element).localName) ? FILTER_REJECT : FILTER_SKIP;
      return detect((node as Text).data) ? FILTER_ACCEPT : FILTER_SKIP;
    },
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node as Text;
    const decoded = decode(text.data);
    if (decoded === undefined || text.parentElement === null) continue;
    found.push({ kind: "text", id: `t${identityOf(text)}`, element: text.parentElement, node: text, key: decoded.key, value: strip(decoded.value) });
  }
  return found;
}

const LEGAL_LOCAL_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const LEGAL_ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9_:-]*$/;
const NEVER_RENDERED_SELECTOR = [...NEVER_RENDERED].join(",");
const FOLLOWING = 0x04;
const CONTAINED_BY = 0x10;

/**
 * De-duplicates attribute names and drops any that is not a legal name, so a
 * name a Developer declared can never inject selector syntax.
 */
function legalAttributeNames(names: readonly string[]): string[] {
  return [...new Set(names)].filter((name) => LEGAL_ATTRIBUTE_NAME.test(name));
}

function scanAttributes(root: Document | Element, names: readonly string[]): FoundAttribute[] {
  const legal = legalAttributeNames(names);
  if (legal.length === 0) return [];
  // Selection by presence keeps the attribute pass cheap on large pages. A
  // colon is legal in an attribute name but must be escaped in a selector, and
  // a namespaced attribute (SVG's xlink:href) is only matched by its local
  // name in any namespace. Candidates are verified by qualified name below.
  const selector = legal
    .flatMap((name) => {
      const colon = name.indexOf(":");
      if (colon === -1) return [`[${name}]`];
      const local = name.slice(colon + 1);
      const escaped = `[${name.replaceAll(":", "\\:")}]`;
      return LEGAL_LOCAL_NAME.test(local) ? [escaped, `[*|${local}]`] : [escaped];
    })
    .join(",");
  const elements = Array.from(root.querySelectorAll(selector));
  if (root.nodeType === 1 && (root as Element).matches(selector)) elements.unshift(root as Element);
  const found: FoundAttribute[] = [];
  for (const element of elements) {
    for (const attribute of legal) {
      const raw = element.getAttribute(attribute);
      if (raw === null || !detect(raw)) continue;
      const decoded = decode(raw);
      if (decoded === undefined || element.closest(NEVER_RENDERED_SELECTOR) !== null) continue;
      found.push({ kind: "attribute", id: `a${identityOf(element)}:${attribute}`, element, attribute, key: decoded.key, value: strip(decoded.value) });
    }
  }
  return found;
}

/** Options for {@link scan}. */
export interface ScanOptions {
  /** Attribute names to search for Markers. With none, only text is scanned. */
  attributes?: readonly string[];
}

/**
 * Finds every marked translation under `root`, a document or any element, in
 * document order. An element's attribute translations come before its own
 * text.
 */
export function scan(root: Document | Element, options: ScanOptions = {}): Found[] {
  const text = scanText(root);
  const attributes = scanAttributes(root, options.attributes ?? []);
  if (attributes.length === 0) return text;
  const merged: Found[] = [];
  let t = 0;
  for (const attribute of attributes) {
    while (t < text.length && !(attribute.element.compareDocumentPosition(text[t]!.node) & (FOLLOWING | CONTAINED_BY))) merged.push(text[t++]!);
    merged.push(attribute);
  }
  while (t < text.length) merged.push(text[t++]!);
  return merged;
}
