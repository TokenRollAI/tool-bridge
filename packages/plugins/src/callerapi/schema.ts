/**
 * CallerAPI 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getUserInformationInput = z.strictObject({}).describe('The input payload for retrieving CallerAPI account details.')

export const getUserInformationOutput = z.strictObject({
  status: z.string().describe('The request status returned by CallerAPI.').optional(),
  email: z.string().describe('The authenticated account email address.').optional(),
  credits_spent: z.int().min(0).describe('The number of credits spent by the account.').optional(),
  credits_monthly: z.int().min(0).describe('The monthly credit allocation for the account.').optional(),
  credits_left: z.int().min(0).describe('The number of credits left in the account.').optional(),
}).describe('The CallerAPI account information response.')

export const getPhoneNumberInformationInput = z.strictObject({
  phone: z.string().min(1).describe('The phone number to look up. CallerAPI accepts E.164 input.'),
  hlr: z.boolean().describe('Whether to include HLR carrier data in the CallerAPI lookup.').optional(),
}).describe('The input payload for looking up CallerAPI phone number information.')

export const getPhoneNumberInformationOutput = z.strictObject({
  status: z.string().describe('The request status returned by CallerAPI.'),
  data: z.looseObject({
    phone: z.string().describe('The phone number returned by CallerAPI.').optional(),
    is_spam: z.boolean().describe('Whether the number is marked as spam.').optional(),
    reputation: z.string().describe('The reputation label for the number.').optional(),
    spam_score: z.int().min(0).max(100).describe('The spam likelihood score from 0 to 100.').optional(),
    entity_type: z.string().describe('The entity type returned by CallerAPI.').optional(),
    total_complaints: z.int().min(0).describe('The total complaint count recorded for the number.').optional(),
    complaints: z.array(z.looseObject({
      CreatedDate: z.string().describe('The date and time when the complaint was created.').optional(),
      ViolationDate: z.string().describe('The date and time when the reported violation occurred.').optional(),
      ConsumerState: z.string().describe('The consumer state associated with the complaint.').optional(),
      Subject: z.string().describe('The complaint subject or category.').optional(),
      RecordedMessageOrRobocall: z.string().describe('Whether the complaint involved a robocall.').optional(),
      Comment: z.string().describe('Additional complaint details when provided.').optional(),
    }).describe('A complaint record returned by CallerAPI.')).describe('The complaints returned for the phone number.').optional(),
    business_info: z.looseObject({
      business_name: z.string().describe('The associated business name.').optional(),
      category: z.string().describe('The high-level business category.').optional(),
      city: z.string().describe('The business city.').optional(),
      state: z.string().describe('The business state or province.').optional(),
      country: z.string().describe('The business country code.').optional(),
      industry: z.string().describe('The business industry.').optional(),
      verified: z.boolean().describe('Whether CallerAPI marks the business as verified.').optional(),
    }).describe('Business details associated with the phone number.').optional(),
    carrier_info: z.looseObject({
      country: z.looseObject({
        iso: z.string().describe('The ISO country code.').optional(),
        code: z.string().describe('The country calling code.').optional(),
        name: z.string().describe('The full country name.').optional(),
      }).describe('Country information returned with carrier details.').optional(),
      network: z.looseObject({
        carrier: z.string().describe('The current carrier name.').optional(),
        ocn: z.string().describe('The operating company number.').optional(),
        spid: z.string().describe('The service provider ID.').optional(),
        type: z.string().describe('The network type returned by CallerAPI.').optional(),
        original: z.looseObject({
          carrier: z.string().describe('The original carrier name.').optional(),
          ocn: z.string().describe('The original operating company number.').optional(),
          spid: z.string().describe('The original service provider ID.').optional(),
        }).describe('Original carrier information returned with carrier details.').optional(),
      }).describe('Network information returned with carrier details.').optional(),
      number: z.looseObject({
        lrn: z.string().describe('The location routing number.').optional(),
        type: z.string().describe('The number type returned by CallerAPI.').optional(),
        valid: z.string().describe('The number validity status.').optional(),
        mobile: z.boolean().describe('Whether CallerAPI reports the number as mobile.').optional(),
        msisdn: z.string().describe('The phone number in MSISDN format.').optional(),
        ported: z.boolean().describe('Whether the number has been ported.').optional(),
        ported_date: z.string().describe('The date when the number was ported.').optional(),
        landline: z.boolean().describe('Whether CallerAPI reports the number as landline.').optional(),
        timezone: z.string().describe('The number time zone.').optional(),
        reachable: z.string().describe('The number reachability status.').optional(),
        local_format: z.string().describe('The local number format.').optional(),
      }).describe('Number details returned with carrier information.').optional(),
    }).describe('Carrier and HLR information returned by CallerAPI.').optional(),
  }).describe('Detailed CallerAPI phone intelligence for a number.').optional(),
}).describe('The phone number information response returned by CallerAPI.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const callerapiActions = {
  get_user_information: {
    description: 'Retrieve the authenticated CallerAPI account email and credit balance.',
    effect: 'read',
    inputSchema: getUserInformationInput,
    outputSchema: z.toJSONSchema(getUserInformationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_phone_number_information: {
    description: 'Look up CallerAPI spam reputation, business details, complaints, and optional HLR carrier data for a phone number.',
    effect: 'read',
    inputSchema: getPhoneNumberInformationInput,
    outputSchema: z.toJSONSchema(getPhoneNumberInformationOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
