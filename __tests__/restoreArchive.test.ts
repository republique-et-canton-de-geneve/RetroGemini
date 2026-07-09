import { gzipSync } from 'zlib';
import { describe, expect, it } from 'vitest';
import { parseRestoreArchiveBody } from '../server/services/restoreArchive.js';

describe('restore archive parsing', () => {
  it('normalizes non-string content types before archive parsing', async () => {
    const archive = gzipSync(Buffer.from(JSON.stringify({ teams: [] }), 'utf8'));

    const data = await parseRestoreArchiveBody(
      archive,
      ['application/gzip'],
      1024 * 1024
    );

    expect(data).toEqual({ teams: [] });
  });

  it('parses plaintext JSON uploads even when the client labels them as gzip', async () => {
    const archive = Buffer.from(JSON.stringify({ teams: [] }), 'utf8');

    const data = await parseRestoreArchiveBody(
      archive,
      'application/gzip',
      1024 * 1024
    );

    expect(data).toEqual({ teams: [] });
  });

  it('rejects non-buffer archive bodies before inspecting size or content', async () => {
    await expect(parseRestoreArchiveBody('{"teams":[]}', 'application/json')).rejects.toMatchObject({
      code: 'INVALID_RESTORE_ARCHIVE'
    });
  });
});
