#!/usr/bin/env node
/**
 * CLI wrapper: `node scripts/stampSbom.mjs <sbom.json> <version>`.
 * Exits non-zero on anything unexpected, so a release never uploads an SBOM
 * that still carries `package.json`'s placeholder identity.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { stampSbomVersion } from './sbomVersion.mjs';

const [path, version] = process.argv.slice(2);

if (!path || !version) {
  console.error('Usage: node scripts/stampSbom.mjs <sbom.json> <version>');
  process.exit(1);
}

const sbom = JSON.parse(readFileSync(path, 'utf8'));
const { from, to, references } = stampSbomVersion(sbom, version);
writeFileSync(path, `${JSON.stringify(sbom, null, 2)}\n`);

console.log(`Stamped SBOM root component ${from} -> ${to} (${references} graph reference(s) updated)`);
