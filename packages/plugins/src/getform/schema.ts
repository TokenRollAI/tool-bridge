/**
 * Getform 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const submitFormInput = z.strictObject({
  formId: z.string().min(1).describe('The Forminit form ID that will receive the submission.').optional(),
  blocks: z.array(z.union([z.strictObject({
    type: z.literal('sender').describe('The sender block type.').optional(),
    properties: z.strictObject({
      email: z.string().min(1).describe('Submitter email address.').optional(),
      firstName: z.string().describe('Submitter first name.').optional(),
      lastName: z.string().describe('Submitter last name.').optional(),
      fullName: z.string().describe('Submitter full name.').optional(),
      phone: z.string().describe('Submitter phone number in E.164 format when provided.').optional(),
      title: z.string().describe('Submitter title, such as Mr, Mrs, Dr, or Prof.').optional(),
      userId: z.string().describe('Application-specific submitter identifier.').optional(),
      address: z.string().describe('Submitter street address.').optional(),
      city: z.string().describe('Submitter city.').optional(),
      country: z.string().describe('Submitter country as an ISO 3166-1 alpha-2 code.').optional(),
      company: z.string().describe('Submitter company or organization.').optional(),
      position: z.string().describe('Submitter job title or position.').optional(),
    }).describe('Properties accepted by the Forminit sender block.').optional(),
  }).describe('Sender block used to describe the submitter.'), z.strictObject({
    type: z.literal('tracking').describe('The tracking block type.').optional(),
    properties: z.strictObject({
      utmSource: z.string().describe('Campaign traffic source, such as google or newsletter.').optional(),
      utmMedium: z.string().describe('Marketing medium, such as cpc or email.').optional(),
      utmCampaign: z.string().describe('Campaign name or identifier.').optional(),
      utmTerm: z.string().describe('Paid keyword or search term.').optional(),
      utmContent: z.string().describe('Ad or content variant identifier.').optional(),
      referrer: z.string().describe('Previous page URL or referrer label.').optional(),
      gclid: z.string().describe('Google Ads click identifier.').optional(),
      wbraid: z.string().describe('Google Web to App conversion identifier.').optional(),
      gbraid: z.string().describe('Google App to Web conversion identifier.').optional(),
      fbclid: z.string().describe('Facebook click identifier.').optional(),
      msclkid: z.string().describe('Microsoft Ads click identifier.').optional(),
      ttclid: z.string().describe('TikTok click identifier.').optional(),
      twclid: z.string().describe('Twitter/X click identifier.').optional(),
      li_fat_id: z.string().describe('LinkedIn click identifier.').optional(),
      amzclid: z.string().describe('Amazon Ads click identifier.').optional(),
      mc_cid: z.string().describe('Mailchimp campaign ID.').optional(),
      mc_eid: z.string().describe('Mailchimp subscriber ID.').optional(),
    }).describe('Properties accepted by the Forminit tracking block.').optional(),
  }).describe('Tracking block used to send attribution metadata.'), z.strictObject({
    type: z.enum(['text', 'number', 'email', 'phone', 'url', 'date', 'rating', 'select', 'radio', 'checkbox', 'country']).describe('Supported JSON field block type.').optional(),
    name: z.string().min(1).describe('Unique identifier of the field block.').optional(),
    value: z.union([z.union([z.string().describe('String field value.'), z.number().describe('Numeric field value.'), z.boolean().describe('Boolean field value.')]).describe('Scalar field value accepted by a supported Forminit field block.'), z.array(z.string().describe('One selected value.')).describe('Array of selected string values.')]).describe('Field block value sent to Forminit.').optional(),
  }).describe('One JSON field block supported by the first-pass Getform provider.')]).describe('One JSON block submitted to Forminit.')).min(1).describe('The JSON blocks payload submitted to Forminit.').optional(),
}).describe('Input payload for submitting a protected Forminit form with JSON blocks.')

export const submitFormOutput = z.strictObject({
  success: z.boolean().describe('Whether the submission was accepted by Forminit.'),
  redirectUrl: z.string().describe('Thank-you page URL returned by Forminit.').optional(),
  submission: z.strictObject({
    hashId: z.string().min(1).describe('Unique submission hash identifier.').optional(),
    date: z.string().min(1).describe('Submission timestamp in YYYY-MM-DD HH:mm:ss format.').optional(),
    blocks: z.record(z.string(), z.union([z.union([z.string().describe('String field value.'), z.number().describe('Numeric field value.'), z.boolean().describe('Boolean field value.')]).describe('Scalar field value accepted by a supported Forminit field block.'), z.array(z.string().describe('One selected value.')).describe('Array of selected values.'), z.looseObject({
      email: z.string().describe('Submitter email address.').optional(),
      firstName: z.string().describe('Submitter first name.').optional(),
      lastName: z.string().describe('Submitter last name.').optional(),
      fullName: z.string().describe('Submitter full name.').optional(),
      phone: z.string().describe('Submitter phone number.').optional(),
      title: z.string().describe('Submitter title.').optional(),
      userId: z.string().describe('Application-specific submitter identifier.').optional(),
      address: z.string().describe('Submitter street address.').optional(),
      city: z.string().describe('Submitter city.').optional(),
      country: z.string().describe('Submitter country code.').optional(),
      company: z.string().describe('Submitter company.').optional(),
      position: z.string().describe('Submitter position.').optional(),
    }).describe('Sender block returned inside a normalized submission blocks object.'), z.looseObject({
      utmSource: z.string().describe('Campaign traffic source.').optional(),
      utmMedium: z.string().describe('Marketing medium.').optional(),
      utmCampaign: z.string().describe('Campaign identifier.').optional(),
      utmTerm: z.string().describe('Paid keyword or search term.').optional(),
      utmContent: z.string().describe('Ad or content variant identifier.').optional(),
      referrer: z.string().describe('Previous page URL or referrer label.').optional(),
      gclid: z.string().describe('Google Ads click identifier.').optional(),
      wbraid: z.string().describe('Google Web to App conversion identifier.').optional(),
      gbraid: z.string().describe('Google App to Web conversion identifier.').optional(),
      fbclid: z.string().describe('Facebook click identifier.').optional(),
      msclkid: z.string().describe('Microsoft Ads click identifier.').optional(),
      ttclid: z.string().describe('TikTok click identifier.').optional(),
      twclid: z.string().describe('Twitter/X click identifier.').optional(),
      li_fat_id: z.string().describe('LinkedIn click identifier.').optional(),
      amzclid: z.string().describe('Amazon Ads click identifier.').optional(),
      mc_cid: z.string().describe('Mailchimp campaign ID.').optional(),
      mc_eid: z.string().describe('Mailchimp subscriber ID.').optional(),
    }).describe('Tracking block returned inside a normalized submission blocks object.')]).describe('One dynamic Forminit block value.')).describe('Dynamic blocks object returned by Forminit for one submission.').optional(),
    submissionInfo: z.looseObject({
      ip: z.string().describe('Source IP address of the submission.').optional(),
      user_agent: z.string().describe('User agent captured for the submission.').optional(),
      referer: z.string().describe('Referrer captured for the submission.').optional(),
      location: z.looseObject({
        country: z.looseObject({
          name: z.string().describe('Country name detected for the submission.').optional(),
          iso: z.string().describe('Country ISO 3166-1 alpha-2 code detected for the submission.').optional(),
        }).describe('Country information returned inside submission location metadata.').optional(),
        city: z.looseObject({
          name: z.string().describe('City name detected for the submission.').optional(),
        }).describe('City information returned inside submission location metadata.').optional(),
        timezone: z.string().describe('IANA timezone detected for the submission.').optional(),
      }).describe('Location metadata returned for a submission when available.').optional(),
    }).describe('Submission info metadata returned by Forminit.').optional(),
  }).describe('Submission payload returned after a successful Forminit form submission.'),
}).describe('Normalized result returned by the Forminit submit form API.')

export const listSubmissionsInput = z.strictObject({
  formId: z.string().min(1).describe('The Forminit form ID whose submissions should be listed.'),
  page: z.int().min(1).describe('The page number to request.').optional(),
  size: z.int().min(1).max(100).describe('The page size to request. Forminit documents a range of 1 to 100.').optional(),
  query: z.string().min(1).describe('Search keyword used to filter submissions.').optional(),
  files: z.boolean().describe('Whether to include file attachment metadata in the response.').optional(),
  timezone: z.string().min(1).describe('IANA timezone name used to format returned dates.').optional(),
}).describe('Input payload for listing submissions from one Forminit form.')

export const listSubmissionsOutput = z.strictObject({
  data: z.strictObject({
    id: z.string().min(1).describe('Form ID that owns the returned submissions.'),
    apiVersion: z.string().describe('API version returned by Forminit.').optional(),
    submissions: z.array(z.strictObject({
      id: z.string().min(1).describe('Unique submission identifier returned by Forminit.'),
      submissionDate: z.string().min(1).describe('Submission timestamp returned by Forminit.'),
      status: z.boolean().describe('Boolean status flag returned for the submission.'),
      submissionStatus: z.string().describe('Submission lifecycle status, such as open.').optional(),
      blocks: z.record(z.string(), z.union([z.union([z.string().describe('String field value.'), z.number().describe('Numeric field value.'), z.boolean().describe('Boolean field value.')]).describe('Scalar field value accepted by a supported Forminit field block.'), z.array(z.string().describe('One selected value.')).describe('Array of selected values.'), z.looseObject({
        email: z.string().describe('Submitter email address.').optional(),
        firstName: z.string().describe('Submitter first name.').optional(),
        lastName: z.string().describe('Submitter last name.').optional(),
        fullName: z.string().describe('Submitter full name.').optional(),
        phone: z.string().describe('Submitter phone number.').optional(),
        title: z.string().describe('Submitter title.').optional(),
        userId: z.string().describe('Application-specific submitter identifier.').optional(),
        address: z.string().describe('Submitter street address.').optional(),
        city: z.string().describe('Submitter city.').optional(),
        country: z.string().describe('Submitter country code.').optional(),
        company: z.string().describe('Submitter company.').optional(),
        position: z.string().describe('Submitter position.').optional(),
      }).describe('Sender block returned inside a normalized submission blocks object.'), z.looseObject({
        utmSource: z.string().describe('Campaign traffic source.').optional(),
        utmMedium: z.string().describe('Marketing medium.').optional(),
        utmCampaign: z.string().describe('Campaign identifier.').optional(),
        utmTerm: z.string().describe('Paid keyword or search term.').optional(),
        utmContent: z.string().describe('Ad or content variant identifier.').optional(),
        referrer: z.string().describe('Previous page URL or referrer label.').optional(),
        gclid: z.string().describe('Google Ads click identifier.').optional(),
        wbraid: z.string().describe('Google Web to App conversion identifier.').optional(),
        gbraid: z.string().describe('Google App to Web conversion identifier.').optional(),
        fbclid: z.string().describe('Facebook click identifier.').optional(),
        msclkid: z.string().describe('Microsoft Ads click identifier.').optional(),
        ttclid: z.string().describe('TikTok click identifier.').optional(),
        twclid: z.string().describe('Twitter/X click identifier.').optional(),
        li_fat_id: z.string().describe('LinkedIn click identifier.').optional(),
        amzclid: z.string().describe('Amazon Ads click identifier.').optional(),
        mc_cid: z.string().describe('Mailchimp campaign ID.').optional(),
        mc_eid: z.string().describe('Mailchimp subscriber ID.').optional(),
      }).describe('Tracking block returned inside a normalized submission blocks object.')]).describe('One dynamic Forminit block value.')).describe('Dynamic blocks object returned by Forminit for one submission.'),
      files: z.array(z.looseObject({
        url: z.string().min(1).describe('File download URL.').optional(),
        name: z.string().describe('Uploaded file name.').optional(),
        label: z.string().describe('Field label or identifier for the file.').optional(),
        size: z.int().min(0).describe('File size in bytes.').optional(),
        type: z.string().describe('MIME type of the uploaded file.').optional(),
      }).describe('One file metadata entry returned when files=true.')).describe('Attached file metadata when requested.').optional(),
    }).describe('One submission returned by the Forminit list API.')).describe('Submissions returned for the requested form.'),
    pagination: z.strictObject({
      count: z.int().min(0).describe('Number of submissions in the current response.').optional(),
      currentPage: z.int().min(1).describe('Current page number.').optional(),
      total: z.int().min(0).describe('Total number of submissions.').optional(),
      firstPage: z.int().min(1).describe('First page number.').optional(),
      lastPage: z.int().min(1).describe('Last page number.').optional(),
      size: z.int().min(1).describe('Page size used for the current response.').optional(),
    }).describe('Pagination metadata returned by the Forminit submissions API.'),
  }).describe('The data envelope returned by the Forminit submissions API.').optional(),
}).describe('Normalized result returned by the Forminit list submissions API.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const getformActions = {
  submit_form: {
    description: 'Submit a protected Forminit form with JSON blocks using the documented sender, tracking, and field block types.',
    effect: 'write',
    inputSchema: submitFormInput,
    outputSchema: z.toJSONSchema(submitFormOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_submissions: {
    description: 'List submissions from one protected Forminit form with pagination, keyword search, optional file metadata, and timezone formatting.',
    effect: 'read',
    inputSchema: listSubmissionsInput,
    outputSchema: z.toJSONSchema(listSubmissionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
