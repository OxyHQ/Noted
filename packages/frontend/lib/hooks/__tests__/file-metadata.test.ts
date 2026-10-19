import { describe, expect, it, vi } from 'vitest';

vi.mock('@oxy.so/services/ui/client', () => ({ useOxy: vi.fn() }));

import { parseFileMeta } from '@/lib/hooks/use-file-metadata';

describe('parseFileMeta', () => {
  it('reads the names GET /assets/:id answers with', () => {
    expect(
      parseFileMeta(
        {
          file: {
            id: 'f',
            originalName: 'plan.pdf',
            mime: 'application/pdf',
            size: 2048,
            status: 'active',
          },
        },
        'f',
      ),
    ).toEqual({
      id: 'f',
      filename: 'plan.pdf',
      contentType: 'application/pdf',
      length: 2048,
      availability: 'available',
    });
  });

  it('still reads the older spelling', () => {
    expect(
      parseFileMeta({ id: 'f', filename: 'a.txt', contentType: 'text/plain', length: 3 }, 'f'),
    ).toMatchObject({
      filename: 'a.txt',
      contentType: 'text/plain',
      length: 3,
      availability: 'available',
    });
  });

  it('says a file Oxy no longer serves is not available', () => {
    expect(parseFileMeta({ file: { status: 'trash' } }, 'f').availability).toBe('trash');
    expect(parseFileMeta({ file: { status: 'blocked' } }, 'f').availability).toBe('unavailable');
    expect(parseFileMeta({ file: { status: 'deleted' } }, 'f').availability).toBe('unavailable');
  });
});
