import fs from 'fs';
import path from 'path';

const VERSION_PATH = path.resolve(process.cwd(), 'app-version.json');

const loadVersion = () => {
  const raw = fs.readFileSync(VERSION_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed.version || typeof parsed.version !== 'string') {
    throw new Error('app-version.json must contain a "version" string.');
  }
  return parsed.version;
};

const parseVersion = (value) => {
  const [majorPart, minorPart] = value.split('.');
  const major = Number.parseInt(majorPart, 10);
  const minor = Number.parseInt(minorPart ?? '0', 10);
  if (Number.isNaN(major) || Number.isNaN(minor)) {
    throw new Error(`Invalid version format: ${value}. Expected x.y.`);
  }
  return { major, minor };
};

const toVersion = ({ major, minor }) => `${major}.${minor}`;

const bumpVersion = (kind, version) => {
  const parsed = parseVersion(version);
  if (kind === 'feature') {
    return toVersion({ major: parsed.major + 1, minor: 0 });
  }
  if (kind === 'fix') {
    return toVersion({ major: parsed.major, minor: parsed.minor + 1 });
  }
  throw new Error('Usage: node scripts/bump-version.mjs <feature|fix>');
};

const run = () => {
  const kind = process.argv[2];
  if (!kind) {
    throw new Error('Usage: node scripts/bump-version.mjs <feature|fix>');
  }

  const current = loadVersion();
  const next = bumpVersion(kind, current);

  fs.writeFileSync(VERSION_PATH, `${JSON.stringify({ version: next }, null, 2)}\n`);
  console.log(`Version updated: ${current} -> ${next}`);
};

run();
