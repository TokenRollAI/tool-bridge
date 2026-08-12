/**
 * tl;dv 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listMeetingsInput = z.strictObject({
  query: z.string().min(1).describe('The text query to search for.').optional(),
  page: z.int().min(1).describe('The page number to return.').optional(),
  limit: z.int().min(1).max(100).describe('The number of meetings to return per page.').optional(),
  from: z.union([z.iso.date().describe('A calendar date accepted by tl;dv.'), z.iso.datetime({ offset: true }).describe('A date-time string accepted by tl;dv.')]).describe('The date or datetime boundary accepted by tl;dv.').optional(),
  to: z.union([z.iso.date().describe('A calendar date accepted by tl;dv.'), z.iso.datetime({ offset: true }).describe('A date-time string accepted by tl;dv.')]).describe('The date or datetime boundary accepted by tl;dv.').optional(),
  onlyParticipated: z.boolean().describe('Whether to only return meetings the API key owner participated in.').optional(),
  meetingType: z.enum(['internal', 'external']).describe('The meeting type filter.').optional(),
}).describe('The input payload for listing tl;dv meetings.')

export const listMeetingsOutput = z.strictObject({
  page: z.number().describe('The current page number.').optional(),
  pages: z.number().describe('The total number of available pages.').optional(),
  total: z.number().describe('The total number of matching meetings.').optional(),
  pageSize: z.number().describe('The number of meetings returned per page.').optional(),
  results: z.array(z.looseObject({
    id: z.string().describe('The tl;dv meeting identifier.').optional(),
    name: z.string().describe('The meeting name.').optional(),
    happenedAt: z.string().describe('The date or datetime when the meeting happened.').optional(),
    url: z.string().describe('The tl;dv web URL for opening the meeting.').optional(),
    duration: z.number().describe('The meeting duration in seconds.').optional(),
    organizer: z.looseObject({
      name: z.string().describe('The user\'s display name.').optional(),
      email: z.string().describe('The user\'s email address.').optional(),
    }).describe('A tl;dv user object.').optional(),
    invitees: z.array(z.looseObject({
      name: z.string().describe('The user\'s display name.').optional(),
      email: z.string().describe('The user\'s email address.').optional(),
    }).describe('A tl;dv user object.')).describe('Users invited to or participating in the meeting.').optional(),
    template: z.unknown().describe('The tl;dv template attached to the meeting.').optional(),
    extraProperties: z.looseObject({}).describe('Additional tl;dv meeting properties.').optional(),
  }).describe('A tl;dv meeting object.')).describe('The meetings returned by tl;dv.').optional(),
}).describe('The paginated tl;dv meetings response.')

export const getMeetingInput = z.strictObject({
  meetingId: z.string().min(1).describe('The tl;dv meeting identifier.').optional(),
}).describe('The input payload for selecting a tl;dv meeting.')

export const getMeetingOutput = z.looseObject({
  id: z.string().describe('The tl;dv meeting identifier.').optional(),
  name: z.string().describe('The meeting name.').optional(),
  happenedAt: z.string().describe('The date or datetime when the meeting happened.').optional(),
  url: z.string().describe('The tl;dv web URL for opening the meeting.').optional(),
  duration: z.number().describe('The meeting duration in seconds.').optional(),
  organizer: z.looseObject({
    name: z.string().describe('The user\'s display name.').optional(),
    email: z.string().describe('The user\'s email address.').optional(),
  }).describe('A tl;dv user object.').optional(),
  invitees: z.array(z.looseObject({
    name: z.string().describe('The user\'s display name.').optional(),
    email: z.string().describe('The user\'s email address.').optional(),
  }).describe('A tl;dv user object.')).describe('Users invited to or participating in the meeting.').optional(),
  template: z.unknown().describe('The tl;dv template attached to the meeting.').optional(),
  extraProperties: z.looseObject({}).describe('Additional tl;dv meeting properties.').optional(),
}).describe('A tl;dv meeting object.')

export const getTranscriptInput = z.strictObject({
  meetingId: z.string().min(1).describe('The tl;dv meeting identifier.').optional(),
}).describe('The input payload for selecting a tl;dv meeting.')

export const getTranscriptOutput = z.strictObject({
  id: z.string().describe('The transcript identifier.').optional(),
  meetingId: z.string().describe('The tl;dv meeting identifier.').optional(),
  data: z.array(z.strictObject({
    speaker: z.string().describe('The speaker for this transcript sentence.').optional(),
    text: z.string().describe('The sentence text.').optional(),
    startTime: z.number().describe('The sentence start time in seconds.').optional(),
    endTime: z.number().describe('The sentence end time in seconds.').optional(),
  }).describe('A sentence from a tl;dv transcript.')).describe('The transcript sentences returned by tl;dv.').optional(),
}).describe('The tl;dv transcript response.')

export const getNotesInput = z.strictObject({
  meetingId: z.string().min(1).describe('The tl;dv meeting identifier.').optional(),
}).describe('The input payload for selecting a tl;dv meeting.')

export const getNotesOutput = z.strictObject({
  structuredNotes: z.array(z.strictObject({
    segmentId: z.string().describe('The tl;dv segment identifier attached to the note.').optional(),
    timestamp: z.number().describe('The note timestamp in seconds.').optional(),
    text: z.string().describe('The note text.').optional(),
    topicId: z.string().describe('The topic identifier for the note.').optional(),
  }).describe('A structured tl;dv meeting note.')).describe('The structured notes returned by tl;dv.').optional(),
  markdownContent: z.string().describe('The meeting notes as Markdown.').optional(),
  topics: z.array(z.strictObject({
    id: z.string().describe('The topic identifier.').optional(),
    order: z.number().describe('The topic sort order.').optional(),
    title: z.string().describe('The topic title.').optional(),
    summary: z.string().describe('The topic summary.').optional(),
  }).describe('A tl;dv AI note topic.')).describe('The AI topics returned by tl;dv.').optional(),
}).describe('The tl;dv meeting notes response.')

export const importMeetingInput = z.strictObject({
  name: z.string().min(1).describe('The name of the meeting or recording to import.'),
  url: z.url().describe('The publicly accessible recording URL that tl;dv should import. Supported media formats include mp3, mp4, wav, m4a, mkv, mov, avi, wma, and flac.'),
  happenedAt: z.iso.datetime({ offset: true }).describe('The meeting or recording datetime. If omitted, tl;dv uses the current date.').optional(),
  dryRun: z.boolean().describe('Whether tl;dv should validate the import without persisting or processing it.').optional(),
  participants: z.array(z.email().describe('A participant email address.')).describe('Email addresses of participants invited to the meeting or recording.').optional(),
}).describe('The input payload for importing a meeting recording into tl;dv.')

export const importMeetingOutput = z.strictObject({
  success: z.boolean().describe('Whether tl;dv accepted the import request.').optional(),
  jobId: z.string().describe('The tl;dv job identifier created for the import.').optional(),
  message: z.string().describe('The message returned by tl;dv for the import request.').optional(),
}).describe('The tl;dv meeting import job response.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const tldvActions = {
  list_meetings: {
    description: 'List tl;dv meetings available to the API key with optional search, date, participation, and meeting-type filters.',
    effect: 'read',
    inputSchema: listMeetingsInput,
    outputSchema: z.toJSONSchema(listMeetingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_meeting: {
    description: 'Get a tl;dv meeting by its identifier.',
    effect: 'read',
    inputSchema: getMeetingInput,
    outputSchema: z.toJSONSchema(getMeetingOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_transcript: {
    description: 'Get the structured transcript for a tl;dv meeting.',
    effect: 'read',
    inputSchema: getTranscriptInput,
    outputSchema: z.toJSONSchema(getTranscriptOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_notes: {
    description: 'Get markdown and structured AI notes for a tl;dv meeting.',
    effect: 'read',
    inputSchema: getNotesInput,
    outputSchema: z.toJSONSchema(getNotesOutput, { io: 'output', unrepresentable: 'any' }),
  },
  import_meeting: {
    description: 'Submit a publicly accessible recording URL to tl;dv for meeting import and receive the created job payload.',
    effect: 'write',
    inputSchema: importMeetingInput,
    outputSchema: z.toJSONSchema(importMeetingOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
