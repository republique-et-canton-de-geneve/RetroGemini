/**
 * Stamps a release version onto a CycloneDX document's **root component**
 * (audit H47, raised by Codex on PR #434).
 *
 * `npm sbom` derives that component from `package.json`, whose `version` is not
 * this project's release identity — `VERSION` is, and `package.json` has sat at
 * `1.1.0` for the life of the repo. So the asset uploaded as
 * `retrogemini-29.2-sbom.cdx.json` described itself as `retrogemini@1.1.0`, and
 * so would every release after it. A filename is not an identity: an
 * asset-inventory scanner reads `metadata.component`, and identical identities
 * across releases is exactly the confusion an SBOM exists to remove.
 *
 * Pure and file-free so the rule can be tested without generating a real SBOM;
 * `scripts/stampSbom.mjs` is the thin CLI around it. Same split as
 * `lintBudget.mjs` / `lint.mjs`.
 */

/** Replaces the version after the LAST `@`, so `@scope/name@1.0.0` survives. */
const withVersion = (identifier, version) =>
  typeof identifier === 'string' && identifier.lastIndexOf('@') > 0
    ? `${identifier.slice(0, identifier.lastIndexOf('@'))}@${version}`
    : identifier;

/**
 * @param {object} sbom  a parsed CycloneDX document (mutated in place)
 * @param {string} version  the release version, e.g. `29.2`
 * @returns {{ from: string, to: string, references: number }}
 * @throws if the document has no root component, or the version is empty
 */
const stampSbomVersion = (sbom, version) => {
  if (typeof version !== 'string' || version.trim() === '') {
    throw new Error('stampSbomVersion: a non-empty version is required');
  }

  const component = sbom?.metadata?.component;
  if (!component) {
    throw new Error('stampSbomVersion: the document has no metadata.component to stamp');
  }

  const from = component['bom-ref'];
  const to = withVersion(from, version);

  component.version = version;
  if (from !== undefined) component['bom-ref'] = to;
  if (component.purl !== undefined) component.purl = withVersion(component.purl, version);

  // The root's `bom-ref` is also the key the dependency graph hangs off, so a
  // rewrite that stopped at `metadata` would leave the graph pointing at a
  // component that no longer exists — a document that is worse than the one it
  // replaced, because it is now internally inconsistent.
  let references = 0;
  for (const entry of sbom.dependencies ?? []) {
    if (entry.ref === from) {
      entry.ref = to;
      references += 1;
    }
    if (Array.isArray(entry.dependsOn)) {
      entry.dependsOn = entry.dependsOn.map((ref) => {
        if (ref !== from) return ref;
        references += 1;
        return to;
      });
    }
  }

  return { from, to, references };
};

export { stampSbomVersion };
