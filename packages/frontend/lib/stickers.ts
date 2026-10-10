/** Published Oxy catalogue IDs shared with Mention; assets resolve on every platform. */
export const EMPTY_STATE_STICKERS = {
  welcome: '01a0eadb-761a-7b2b-bcb2-beee24b2cd17',
  notes: '01a0eada-abf1-7759-bcf4-610c070fcff5',
  search: '01a0eada-9343-7430-8062-8424ea19b842',
  labels: '01a0eadb-4fad-7ea1-8c49-62ceff396792',
  archive: '01a0eadb-0917-74c4-be61-8fd534b4faea',
  trash: '01a0eadb-6e8f-727e-b102-914aa907f2a5',
  reminders: '01a0eadb-feca-7ade-85fb-979d7ab575eb',
  notifications: '01a0eadb-c6a9-7c35-8433-c308f9a4ce03',
  notFound: '01a0eadb-ee07-7b6f-a868-3fea8fc02476',
  loadError: '01a0eadb-a89b-7b15-b07e-779c938c26c3',
  transcript: '01a0eada-9cc9-7d48-98e1-d6ef59830aa7',
  attachments: '01a0eadb-3d1f-7a01-a475-209ffc7ff5d1',
} as const;
export type EmptyStateStickerName = keyof typeof EMPTY_STATE_STICKERS;
