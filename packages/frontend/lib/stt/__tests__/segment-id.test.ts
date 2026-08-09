import { describe, expect, it } from 'vitest';

import { parseSegmentId, segmentId } from '@/lib/stt/segment-id';

describe('segmentId', () => {
  it('gives the same name to the same position, every time', () => {
    // The bug this replaces: whisper re-emits a slice as it fills, the old code
    // minted a fresh id per emission, and the note carried the same sentence
    // back in four increasingly complete versions.
    const position = { captureId: 'cap_1', sliceIndex: 3, segmentIndex: 2 };
    expect(segmentId(position)).toBe(segmentId({ ...position }));
    expect(segmentId(position)).toBe('cap_1#3.2');
  });

  it('gives different names to different positions', () => {
    expect(segmentId({ captureId: 'c', sliceIndex: 1, segmentIndex: 2 })).not.toBe(
      segmentId({ captureId: 'c', sliceIndex: 2, segmentIndex: 1 }),
    );
    expect(segmentId({ captureId: 'a', sliceIndex: 0, segmentIndex: 0 })).not.toBe(
      segmentId({ captureId: 'b', sliceIndex: 0, segmentIndex: 0 }),
    );
  });
});

describe('parseSegmentId', () => {
  it('reads a position back', () => {
    expect(parseSegmentId('cap_1#12.4')).toEqual({
      captureId: 'cap_1',
      sliceIndex: 12,
      segmentIndex: 4,
    });
  });

  it('round-trips', () => {
    const position = { captureId: 'Qx-9_zA', sliceIndex: 7, segmentIndex: 0 };
    expect(parseSegmentId(segmentId(position))).toEqual(position);
  });

  it('says nothing about a row written before segments had positions', () => {
    // Those rows are real transcript, so "position unknown" is the honest
    // answer rather than treating them as corrupt.
    expect(parseSegmentId('V1StGXR8_Z5jdHi6B-myT')).toBeNull();
    expect(parseSegmentId('')).toBeNull();
    expect(parseSegmentId('cap#notanumber.2')).toBeNull();
  });
});
