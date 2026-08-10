/**
 * The recording reported in #59, as a fixture.
 *
 * A single-speaker talk by somebody who says they are an education minister. It
 * is here because it is the exact shape the note generator was getting wrong: no
 * tasks, no decisions, no dialogue — a person explaining a line of reasoning in
 * the FIRST person, which an extractive pass then reproduced verbatim so the note
 * read as though the speaker had written it.
 *
 * Kept verbatim, whitespace-normalised only. It is evidence, and a fixture that
 * quietly tidied its input would be testing a recording nobody made. The
 * recogniser's own mistakes ("Judge ETP", "OSCD", "fax the education") are part
 * of it on purpose: they are what a real transcript looks like, and one of the
 * things the note has to survive.
 *
 * Anonymised by omission rather than by editing — the speaker never states their
 * name, which is itself one of the properties under test: the note must not
 * invent one.
 */

import type { TranscriptSegment } from '@/lib/capture/captures-repo';

export const TALK_CAPTURE_ID = 'cap_talk';

/** One entry per slice of the reported page, with its offset. */
export const TALK_SLICES: readonly { atMs: number; text: string }[] = [
  { atMs: 0, text: 'I\'m going to talk about humans because when I became a minister now more than three years ago, I believe that\'s very long time ago. Judge ETP have been out for five months. It was in November 2022 and I became a minister in April of 2023. And my advisor came to me and said to the minister, I said, think we need to do something about AI. And I said, okay, what should we do? And he says, I\'m not sure. So another two months we started working on different policies that we had to develop. this was our agenda, but AI was not on the agenda when I became a minister. This is something that I didn\'t think about, but it was there. So two months later, my advisor comes back to me and says, I think still that we need to do something about AI. because students are already using it in schools. And I said, fine, what do we do about it? Because I said, I still don\'t know. So what we did was that we went to the smarter people,' },
  { atMs: 60000, text: 'people who actually knew something about it. about AI. And we had a lot of rounds of meetings and discussions with neuroscientists, with cognitive scientists, with tech companies, with IT, people, to just to figure out how is AI? on our fax the education and learning and what should we as a policy makers to about it. And what we came up with was that it\'s not about technology. We don\'t have to care about the technology because the technology is part of the other discipline. We, as a minister of education, I have to care about the learning, what happens to the learning, to the human brain, and the human capacity to learn if the technology advances to the stage where it was already back then. So my question was then when AI is here and when AI is so magnificent, then what is something that we have to do with the education system for the humans of next generation? But it\'s not a new question because back in 2017 already, OSCD, which was an international' },
  { atMs: 118000, text: 'organization of economic cooperation, did a survey of labor skills, the workers in the workforce. And they found out that two thirds of the workforce already at that time had a literacy and numeracy and digital skills lower than the computers at that time. time. So human capacity to think, to analyze, to calculate, to functionally read, and understand the text was already lower when compared to the computers at that. time. So that was a very big question to the education system. So what about the humans? Should we actually give up learning altogether? Why would we need to develop all brains and our capacity to think, to analyze? And many other things, if there are computers who can do this, that can do this. Like, what is exactly the education then for? And that\'s a very big question. So we were struggling with this question for almost a year. in the ministry when we were discussing with the experts about this.' },
  { atMs: 178000, text: 'And we came to the realization that it\'s not a first time in human history when the technology puts humans under the cognitive pressure. under the like true evolutionary pressure. One time when it was happening was when the printed press was invented, when humans, the literacy, the reading skills were not universal, but then the printing press was invented and happened to humankind was that every human learned to read. So all the humans actually involved in a capacity to learn reading. So what we realized was that after a very long period of time humankind is again again in a very significant evolutionary leap pressure. So we have to evolve. We have to evolve as humans and the main evolving pressure is our brains. It\'s not the ability to stand up in one fast. It\'s not as physical. evolutionary pressure, but it\'s a mental cognitive evolutionary pressure. So what we have to do is that we have to think faster.' },
];

/**
 * The transcript as segments, one per slice.
 *
 * Real slices are shorter than a minute of speech; these are the four the page
 * showed, which is what makes this a regression fixture for the reported case
 * rather than a synthetic one.
 */
export const TALK_SEGMENTS: readonly TranscriptSegment[] = TALK_SLICES.map((slice, index) => ({
  id: `${TALK_CAPTURE_ID}#${String(index)}.0`,
  captureId: TALK_CAPTURE_ID,
  sliceIndex: index,
  segmentIndex: 0,
  revision: index,
  startMs: slice.atMs,
  endMs: slice.atMs + 58_000,
  text: slice.text,
  confidence: null,
  speakerHint: null,
  isFinal: true,
}));
