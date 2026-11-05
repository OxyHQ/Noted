/**
 * Checks only identity transitions already visible to these sources. Callers
 * still need to coordinate the final database commit with the real lifecycle.
 */
export function captureRecordingSession(sources: {
  epoch: () => number;
  projection: () => { viewerId: string | null; sessionId: string | null };
  localViewer: () => string | null;
}): () => void {
  const epoch = sources.epoch();
  const { viewerId, sessionId } = sources.projection();
  if (!viewerId || !sessionId || sources.localViewer() !== viewerId)
    throw new Error('Recording session is unavailable');
  return () => {
    const current = sources.projection();
    if (
      sources.epoch() !== epoch ||
      sources.localViewer() !== viewerId ||
      current.viewerId !== viewerId ||
      current.sessionId !== sessionId
    ) {
      throw new Error('Recording session changed');
    }
  };
}
