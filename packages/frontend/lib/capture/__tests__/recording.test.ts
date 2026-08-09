import { describe, expect, it } from 'vitest';

import {
  dbToLevel,
  METERING_FLOOR_DB,
  pcmToDb,
  pushLevel,
  WAVEFORM_BARS,
} from '@/lib/capture/recording';

/** Build a PCM block from signed 16-bit samples, little-endian. */
function pcm(samples: readonly number[], byteOffset = 0): Uint8Array {
  const buffer = new ArrayBuffer(byteOffset + samples.length * 2);
  const view = new DataView(buffer);
  samples.forEach((sample, index) => view.setInt16(byteOffset + index * 2, sample, true));
  return new Uint8Array(buffer, byteOffset, samples.length * 2);
}

describe('dbToLevel', () => {
  it('draws nothing at the floor', () => {
    expect(dbToLevel(METERING_FLOOR_DB)).toBe(0);
  });

  it('draws a full bar at full scale', () => {
    expect(dbToLevel(0)).toBe(1);
  });

  it('never leaves the range a bar can draw', () => {
    expect(dbToLevel(-120)).toBe(0);
    expect(dbToLevel(12)).toBe(1);
  });
});

describe('pcmToDb', () => {
  it('reports silence as the floor rather than negative infinity', () => {
    // log10(0) is -Infinity, which would propagate into a bar height and a
    // style property before anything noticed.
    expect(pcmToDb(pcm([0, 0, 0, 0]))).toBe(METERING_FLOOR_DB);
  });

  it('reports an empty block as the floor', () => {
    expect(pcmToDb(new Uint8Array(0))).toBe(METERING_FLOOR_DB);
  });

  it('reads a full-scale tone as roughly full scale', () => {
    expect(pcmToDb(pcm([32_767, -32_768, 32_767, -32_768]))).toBeGreaterThan(-0.1);
  });

  it('reads a quiet block as quieter than a loud one', () => {
    const quiet = pcmToDb(pcm([300, -300, 300, -300]));
    const loud = pcmToDb(pcm([20_000, -20_000, 20_000, -20_000]));
    expect(quiet).toBeLessThan(loud);
    expect(quiet).toBeGreaterThan(METERING_FLOOR_DB);
  });

  it('reads a block that does not start on an even byte', () => {
    // The native stream hands over a view into a larger buffer, and its offset
    // is not guaranteed to be even. An `Int16Array` view would throw on this;
    // the loud reading proves the samples were decoded, not merely survived.
    const odd = pcm([20_000, -20_000, 20_000, -20_000], 1);
    expect(odd.byteOffset % 2).toBe(1);
    expect(pcmToDb(odd)).toBeGreaterThan(METERING_FLOOR_DB + 10);
  });
});

describe('pushLevel', () => {
  it('starts from a full window of silence so the waveform does not grow', () => {
    const levels = pushLevel(null, 0.5);
    expect(levels).toHaveLength(WAVEFORM_BARS);
    expect(levels[WAVEFORM_BARS - 1]).toBe(0.5);
    expect(levels[0]).toBe(0);
  });

  it('scrolls, keeping the width fixed', () => {
    let levels = pushLevel(null, 0.1);
    levels = pushLevel(levels, 0.2);
    expect(levels).toHaveLength(WAVEFORM_BARS);
    expect(levels.slice(-2)).toEqual([0.1, 0.2]);
  });
});
