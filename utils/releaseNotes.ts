import { ReleaseNote } from '../types';

const parseVersion = (value: string) => {
  const [majorPart, minorPart] = value.split('.');
  const major = Number.parseInt(majorPart, 10);
  const minor = Number.parseInt(minorPart ?? '0', 10);
  return {
    major: Number.isNaN(major) ? 0 : major,
    minor: Number.isNaN(minor) ? 0 : minor
  };
};

export const compareVersions = (a: string, b: string) => {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (left.major !== right.major) return left.major - right.major;
  return left.minor - right.minor;
};

export const getUnseenReleaseNotes = (
  notes: ReleaseNote[],
  lastSeenVersion: string | undefined,
  currentVersion: string
) => {
  const lastSeen = lastSeenVersion ?? '0.0';

  return notes
    .filter(note => compareVersions(note.version, lastSeen) > 0)
    .filter(note => compareVersions(note.version, currentVersion) <= 0)
    .sort((a, b) => compareVersions(b.version, a.version));
};
