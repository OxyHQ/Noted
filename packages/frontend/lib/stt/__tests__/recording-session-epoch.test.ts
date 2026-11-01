import { OxyServices } from '@oxy.so/core';
import { expect, it } from 'vitest';
import { IncrementalWavWriter, type ReservedWavFile } from '../incremental-wav';
import { captureRecordingSession } from '../recording-session';

function token(viewer: string, nonce = 'first'): string {
  const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode({ userId: viewer, sessionId: `session-${viewer}`, nonce, exp: 2_000_000_000 })}.fixture`;
}

it('rejects A to B to A after OxyServices observes both transitions', async () => {
  const oxy = new OxyServices({ baseURL: 'https://example.test', enableCache: false });
  oxy.session.setAccessToken(token('A'));
  let localViewer = 'A';
  let observedViewer = 'A';
  let observedSession = 'session-A';
  const assertSession = captureRecordingSession({
    epoch: () => oxy.http.getSessionEpoch(),
    localViewer: () => localViewer,
    projection: () => ({ viewerId: observedViewer, sessionId: observedSession }),
  });
  let size = 0;
  const sink: ReservedWavFile = {
    async writeAt(offset, bytes) {
      size = Math.max(size, offset + bytes.length);
      return bytes.length;
    },
    async size() {
      return size;
    },
    async close() {},
  };
  const writer = await IncrementalWavWriter.create(sink, 1024);
  writer.append(Uint8Array.of(1, 2));
  oxy.session.setAccessToken(token('B'));
  localViewer = 'B';
  observedViewer = 'B';
  observedSession = 'session-B';
  oxy.session.setAccessToken(token('A', 'again'));
  localViewer = 'A';
  observedViewer = 'A';
  observedSession = 'session-A';
  await expect(writer.finish(assertSession)).rejects.toThrow('Recording session changed');
});

it('accepts same-session token rotation but rejects local or projected mismatch', () => {
  const oxy = new OxyServices({ baseURL: 'https://example.test', enableCache: false });
  oxy.session.setAccessToken(token('A'));
  let localViewer = 'A';
  let sessionId = 'session-A';
  const assertSession = captureRecordingSession({
    epoch: () => oxy.http.getSessionEpoch(),
    localViewer: () => localViewer,
    projection: () => ({ viewerId: 'A', sessionId }),
  });
  oxy.session.setAccessToken(token('A', 'renewed'));
  expect(assertSession).not.toThrow();
  localViewer = 'B';
  expect(assertSession).toThrow('Recording session changed');
  localViewer = 'A';
  sessionId = 'different-session';
  expect(assertSession).toThrow('Recording session changed');
});
