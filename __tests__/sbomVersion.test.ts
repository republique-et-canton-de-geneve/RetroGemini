import { describe, expect, it } from 'vitest';
import { stampSbomVersion } from '../scripts/sbomVersion.mjs';

/**
 * Audit H47 / Codex on PR #434 — the release SBOM must carry the release's
 * identity, not `package.json`'s.
 *
 * `npm sbom` builds the root component from `package.json`, which in this repo
 * has read `1.1.0` since the beginning; `VERSION` is the release identity. So
 * the asset uploaded as `retrogemini-29.2-sbom.cdx.json` described itself as
 * `retrogemini@1.1.0`, and so would every release after it — an inventory
 * scanner reads `metadata.component`, not the filename, so two different
 * deployments were indistinguishable inside the document.
 */

const sample = () => ({
  bomFormat: 'CycloneDX',
  metadata: {
    component: {
      'bom-ref': 'retrogemini@1.1.0',
      type: 'library',
      name: 'RetroGemini',
      version: '1.1.0',
      purl: 'pkg:npm/retrogemini@1.1.0',
    },
  },
  dependencies: [
    { ref: 'retrogemini@1.1.0', dependsOn: ['express@5.2.1', 'redis@6.2.1'] },
    { ref: 'express@5.2.1', dependsOn: [] },
  ],
});

describe('stampSbomVersion', () => {
  it('stamps the release version onto the root component', () => {
    const sbom = sample();

    stampSbomVersion(sbom, '29.2');

    expect(sbom.metadata.component.version).toBe('29.2');
    expect(sbom.metadata.component['bom-ref']).toBe('retrogemini@29.2');
    expect(sbom.metadata.component.purl).toBe('pkg:npm/retrogemini@29.2');
  });

  it('rewrites the dependency graph that hangs off the root ref', () => {
    // Stopping at `metadata` would leave the graph pointing at a component that
    // no longer exists — an internally inconsistent document, which is worse
    // than the wrong-but-coherent one it replaced.
    const sbom = sample();

    const { references } = stampSbomVersion(sbom, '29.2');

    expect(sbom.dependencies[0].ref).toBe('retrogemini@29.2');
    expect(references).toBe(1);
    expect(JSON.stringify(sbom)).not.toContain('retrogemini@1.1.0');
  });

  it('rewrites the root wherever it appears as a dependency of something else', () => {
    const sbom = sample();
    sbom.dependencies[1].dependsOn = ['retrogemini@1.1.0'];

    const { references } = stampSbomVersion(sbom, '29.2');

    expect(sbom.dependencies[1].dependsOn).toEqual(['retrogemini@29.2']);
    expect(references).toBe(2);
  });

  it('keeps a scoped package name intact', () => {
    // Only the version after the LAST `@` moves; `@scope/name` must survive.
    const sbom = sample();
    sbom.metadata.component['bom-ref'] = '@geneve/retrogemini@1.1.0';
    sbom.metadata.component.purl = 'pkg:npm/%40geneve/retrogemini@1.1.0';

    stampSbomVersion(sbom, '29.2');

    expect(sbom.metadata.component['bom-ref']).toBe('@geneve/retrogemini@29.2');
    expect(sbom.metadata.component.purl).toBe('pkg:npm/%40geneve/retrogemini@29.2');
  });

  it('refuses an empty version rather than stamping a nameless release', () => {
    expect(() => stampSbomVersion(sample(), '')).toThrow(/non-empty version/);
  });

  it('refuses a document with no root component', () => {
    // A silent no-op here would upload the unstamped document and report success.
    expect(() => stampSbomVersion({ bomFormat: 'CycloneDX' }, '29.2')).toThrow(/no metadata.component/);
  });
});
