/**
 * Formcarry 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const createFormInput = z.strictObject({
  name: z.string().min(1).describe('Name of the form.'),
  email: z.string().min(1).describe('Comma-separated email addresses that should receive submission notifications.'),
  returnUrl: z.url().describe('URL to redirect users to after a successful submission when not using the built-in thank-you page.').optional(),
  failUrl: z.url().describe('URL to redirect users to after a failed submission when returnUrl is configured.').optional(),
  returnParams: z.boolean().describe('Whether Formcarry should append submission data to the returnUrl query string.').optional(),
  googleRecaptcha: z.string().describe('Google reCAPTCHA secret key used to enable spam protection for the form.').optional(),
  webhook: z.url().describe('Webhook URL that Formcarry should call with a POST request for each submission.').optional(),
  retention: z.boolean().describe('Whether Formcarry should save incoming submissions to its database.').optional(),
}).describe('Basic Formcarry form settings supported by the first provider pass.')

export const createFormOutput = z.looseObject({
  code: z.int().describe('Numeric status code returned by Formcarry.'),
  title: z.string().describe('Title message returned by Formcarry.'),
  message: z.string().describe('Human-readable message returned by Formcarry.'),
  type: z.string().describe('Result type returned by Formcarry.'),
  formUrl: z.string().describe('Hosted Formcarry form URL created for the new form.'),
}).describe('Successful response returned after creating a Formcarry form.')

export const deleteFormInput = z.strictObject({
  form_id: z.string().min(1).describe('Formcarry form ID to delete.'),
}).describe('Path parameters for deleting a Formcarry form.')

export const deleteFormOutput = z.looseObject({
  code: z.int().describe('Numeric status code returned by Formcarry.'),
  title: z.string().describe('Title message returned by Formcarry.'),
  message: z.string().describe('Human-readable message returned by Formcarry.'),
  type: z.string().describe('Result type returned by Formcarry.'),
}).describe('Base success payload returned by Formcarry form mutation endpoints.')

export const listSubmissionsInput = z.strictObject({
  form_id: z.string().min(1).describe('Formcarry form ID whose submissions should be retrieved.'),
  limit: z.int().min(1).max(50).describe('Maximum number of submissions to return. Formcarry documents a maximum of 50.').optional(),
  page: z.int().min(1).describe('Page number to retrieve.').optional(),
  sort: z.string().describe('Sorting criteria in the format field:order, such as createdAt:-1 or createdAt:1.').optional(),
  filter: z.string().describe('Comma-separated filter expressions in the format key:value, including documented filters like date:7, attachments:true, or spam:false.').optional(),
}).describe('Path and query parameters accepted by the Formcarry submissions endpoint.')

export const listSubmissionsOutput = z.looseObject({
  form: z.string().describe('Form ID whose submissions were requested.'),
  results: z.int().describe('Number of submissions returned in the current response.'),
  submissions: z.array(z.looseObject({
    _id: z.string().describe('Unique identifier of the submission.').optional(),
    form: z.string().describe('Form ID associated with the submission.').optional(),
    createdAt: z.string().describe('Timestamp when the submission was created.').optional(),
    updatedAt: z.string().describe('Timestamp when the submission was last updated.').optional(),
    fields: z.array(z.looseObject({
      key: z.string().describe('Field key returned by Formcarry.').optional(),
      label: z.string().describe('Field label returned by Formcarry.').optional(),
      type: z.string().describe('Field type returned by Formcarry.').optional(),
      value: z.unknown().describe('Field value returned by Formcarry.').optional(),
    }).describe('Submission field entry returned by Formcarry.')).describe('Field values captured in the submission.').optional(),
  }).describe('Submission object returned by Formcarry.')).describe('Submissions returned by Formcarry.'),
  pagination: z.looseObject({
    current_page: z.int().describe('Current page number.'),
    previous_page: z.int().describe('Previous page number, or null when unavailable.').nullable(),
    next_page: z.int().describe('Next page number, or null when unavailable.').nullable(),
    total_page: z.int().describe('Total number of available pages.'),
    total_submissions: z.int().describe('Total number of submissions available for the form.'),
  }).describe('Pagination metadata returned by Formcarry.'),
}).describe('Submission list response returned by Formcarry.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const formcarryActions = {
  create_form: {
    description: 'Create a new Formcarry form with basic notification, redirect, and storage settings.',
    effect: 'write',
    inputSchema: createFormInput,
    outputSchema: z.toJSONSchema(createFormOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_form: {
    description: 'Delete an existing Formcarry form by ID.',
    effect: 'destructive',
    inputSchema: deleteFormInput,
    outputSchema: z.toJSONSchema(deleteFormOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_submissions: {
    description: 'List submissions for a Formcarry form with the documented pagination, sorting, and filtering query parameters.',
    effect: 'read',
    inputSchema: listSubmissionsInput,
    outputSchema: z.toJSONSchema(listSubmissionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
