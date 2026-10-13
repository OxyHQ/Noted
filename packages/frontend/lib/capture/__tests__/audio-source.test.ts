import { describe, expect, it, vi } from 'vitest';
import {
  MICROPHONE_CONSTRAINTS,
  microphoneSource,
  mixedSource,
  type AudioSource,
  type MixingContext,
} from '@/lib/capture/audio-source';

function fakeStream(label: string) {
  const track = { stop: vi.fn() };
  const stream = { label, getTracks: () => [track, track] } as unknown as MediaStream;
  return { stream, track };
}

describe('microphoneSource', () => {
  it('asks for the same constraints the recorder always used', async () => {
    const { stream } = fakeStream('mic');
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const opened = await microphoneSource({ getUserMedia }).open();
    expect(getUserMedia).toHaveBeenCalledWith(MICROPHONE_CONSTRAINTS);
    expect(MICROPHONE_CONSTRAINTS).toEqual({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    expect(opened.stream).toBe(stream);
  });

  it('stops every track when closed', async () => {
    const { stream, track } = fakeStream('mic');
    const opened = await microphoneSource({ getUserMedia: async () => stream }).open();
    opened.close();
    expect(track.stop).toHaveBeenCalledTimes(2);
  });

  it('lets a refused permission through to the caller', async () => {
    const denied = new Error('NotAllowedError');
    const source = microphoneSource({ getUserMedia: () => Promise.reject(denied) });
    await expect(source.open()).rejects.toBe(denied);
  });
});

function fakeSource(id: 'microphone' | 'system', label: string) {
  const { stream, track } = fakeStream(label);
  const close = vi.fn();
  const source: AudioSource = { id, open: async () => ({ stream, close }) };
  return { source, stream, close, track };
}

function fakeContext() {
  const connections: { from: MediaStream; to: unknown }[] = [];
  const destinationStream = { label: 'mixed' } as unknown as MediaStream;
  const destination = { stream: destinationStream };
  const close = vi.fn();
  const context: MixingContext = {
    createMediaStreamSource: (from) => ({
      connect: (to) => {
        connections.push({ from, to });
      },
    }),
    createMediaStreamDestination: () => destination,
    close,
  };
  return { context, connections, destination, destinationStream, close };
}

describe('mixedSource', () => {
  it('routes every source into ONE destination stream', async () => {
    const mic = fakeSource('microphone', 'mic');
    const system = fakeSource('system', 'system');
    const mix = fakeContext();

    const opened = await mixedSource([mic.source, system.source], () => mix.context).open();

    expect(opened.stream).toBe(mix.destinationStream);
    expect(mix.connections.map((c) => c.from)).toEqual([mic.stream, system.stream]);
    expect(mix.connections.every((c) => c.to === mix.destination)).toBe(true);
  });

  it('closes every source and the context, once', async () => {
    const mic = fakeSource('microphone', 'mic');
    const system = fakeSource('system', 'system');
    const mix = fakeContext();
    const opened = await mixedSource([mic.source, system.source], () => mix.context).open();

    opened.close();
    opened.close();

    expect(mic.close).toHaveBeenCalledTimes(1);
    expect(system.close).toHaveBeenCalledTimes(1);
    expect(mix.close).toHaveBeenCalledTimes(1);
  });

  it('is all-or-nothing: a source that fails closes the ones already open', async () => {
    const mic = fakeSource('microphone', 'mic');
    const failure = new Error('system audio unavailable');
    const broken: AudioSource = { id: 'system', open: () => Promise.reject(failure) };
    const mix = fakeContext();

    await expect(mixedSource([mic.source, broken], () => mix.context).open()).rejects.toBe(failure);

    expect(mic.close).toHaveBeenCalledTimes(1);
    // No context was created for a mix that never existed.
    expect(mix.connections).toEqual([]);
  });
});
