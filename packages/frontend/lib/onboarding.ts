/**
 * When the first-run welcome appears.
 *
 * Only for a brand-new, empty account: someone who already has notes did not
 * just arrive, and a welcome shown to them is an interruption. Both stores have
 * to have answered first — deciding while the local settings or the note list
 * are still loading would flash the welcome at everyone for a frame.
 */
export function shouldShowOnboarding(state: {
  settingsLoading: boolean;
  notesLoading: boolean;
  seen: boolean;
  noteCount: number;
}): boolean {
  if (state.settingsLoading || state.notesLoading) return false;
  return !state.seen && state.noteCount === 0;
}
