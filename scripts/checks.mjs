// Repository checks shared by the lint script and the test suite.

const IMPORT_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\bimport\s+["']([^"']+)["']/g,
];

/**
 * Every module specifier in `source` that is not a relative path. The package
 * has zero runtime dependencies and imports no platform module, so any bare
 * or `node:` specifier is a violation.
 * @param {string} source
 * @returns {string[]}
 */
export function findPlatformImports(source) {
  const found = [];
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined && !specifier.startsWith(".")) found.push(specifier);
    }
  }
  return found;
}

const OUTSIDE_REFERENCE_PATTERNS = [
  { name: "requirement identifier", pattern: /\b[A-Z]{2,4}-\d+\b/ },
  { name: "source path", pattern: /\b(?:src|test|scripts|core-spec)\/[\w./-]+/ },
  { name: "specification document", pattern: /\bdocument\s+\d{2}\b|\bspec(?:ification)?\b/i },
  { name: "ticket number", pattern: /(?:^|[\s(])#\d+\b/ },
];

/**
 * Descriptions of every shipped doc comment (`/** ... *​/`) that points at
 * something a Developer using the package does not have. Ordinary comments
 * are not shipped in the type declarations and are not checked.
 * @param {string} source
 * @returns {string[]}
 */
export function findOutsideDocReferences(source) {
  const problems = [];
  for (const match of source.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const comment = match[0];
    for (const { name, pattern } of OUTSIDE_REFERENCE_PATTERNS) {
      if (pattern.test(comment)) problems.push(`${name} in doc comment: ${comment.slice(0, 60)}`);
    }
  }
  return problems;
}
