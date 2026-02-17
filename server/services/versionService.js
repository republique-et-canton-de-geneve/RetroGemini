import fs from 'fs';
import { join } from 'path';

const createVersionService = ({ rootDir, cacheTtlMs } = {}) => {
  const resolvedTtl = typeof cacheTtlMs === 'number'
    ? cacheTtlMs
    : (process.env.NODE_ENV === 'production' ? 60000 : 0);

  let cachedVersionInfo = null;
  let versionCacheTime = 0;

  const parseVersionAndChangelog = () => {
    let currentVersion = '1.0';
    const announcements = [];

    try {
      const versionPath = join(rootDir, 'VERSION');
      if (fs.existsSync(versionPath)) {
        currentVersion = fs.readFileSync(versionPath, 'utf8').trim();
      }
    } catch (err) {
      console.warn('[Server] Failed to read VERSION file:', err?.message);
    }

    try {
      const changelogPath = join(rootDir, 'CHANGELOG.md');
      if (fs.existsSync(changelogPath)) {
        const content = fs.readFileSync(changelogPath, 'utf8');
        const versionBlocks = content.split(/(?=^## \[)/m).filter((block) => block.trim());

        for (const block of versionBlocks) {
          const headerMatch = block.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/);
          if (!headerMatch) continue;

          const version = headerMatch[1];
          const date = headerMatch[2];
          const items = [];

          const typeMap = {
            Added: 'feature',
            Changed: 'improvement',
            Fixed: 'fix',
            Removed: 'removed',
            Security: 'security'
          };

          const sections = block.split(/^### /m).slice(1);
          for (const section of sections) {
            const lines = section.split('\n');
            const sectionName = lines[0].trim();
            const type = typeMap[sectionName];

            if (!type) continue;

            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (line.startsWith('-') && !line.match(/^-+$/)) {
                const description = line.substring(1).trim();
                if (description && !description.startsWith('<!--') && !description.match(/^-+$/)) {
                  items.push({ type, description });
                }
              }
            }
          }

          if (items.length > 0) {
            announcements.push({ version, date, items });
          }
        }
      }
    } catch (err) {
      console.warn('[Server] Failed to parse CHANGELOG.md:', err?.message);
    }

    return { current: currentVersion, announcements };
  };

  const getVersionInfo = () => {
    const now = Date.now();
    if (!cachedVersionInfo || (now - versionCacheTime) > resolvedTtl) {
      cachedVersionInfo = parseVersionAndChangelog();
      versionCacheTime = now;
    }
    return cachedVersionInfo;
  };

  return { getVersionInfo };
};

export { createVersionService };
