/**
 * Fidel API 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listBrandsInput = z.strictObject({
  limit: z.int().min(1).describe('The maximum number of brands to return.').optional(),
  start: z.string().min(1).describe('The opaque cursor string returned as nextCursor by a previous Fidel list action. Pass it back unchanged.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort order for the upstream created or datetime field.').optional(),
  name: z.string().min(1).describe('Filter brands by name.').optional(),
}).describe('Optional filters for listing Fidel brands.')

export const listBrandsOutput = z.strictObject({
  count: z.int().describe('The number of brands returned by Fidel.'),
  brands: z.array(z.strictObject({
    id: z.string().describe('The Fidel brand ID.'),
    accountId: z.string().describe('The Fidel account ID that owns the brand.').nullable(),
    created: z.string().describe('The ISO timestamp when the brand was created.').nullable(),
    updated: z.string().describe('The ISO timestamp when the brand was last updated.').nullable(),
    name: z.string().describe('The brand display name.').nullable(),
    metadata: z.looseObject({}).describe('The optional metadata object returned by Fidel.').nullable(),
    logoUrl: z.string().describe('The brand logo URL when Fidel returned one.').nullable(),
    live: z.boolean().describe('Whether the brand belongs to the live environment.').nullable(),
    consent: z.boolean().describe('Whether the brand requires cardholder consent.').nullable(),
    websiteUrl: z.string().describe('The brand website URL when Fidel returned one.').nullable(),
  }).describe('A Fidel brand record normalized by the connector.')).describe('The brand records returned by Fidel.'),
  nextCursor: z.string().describe('The cursor string to pass back as start in the next list_brands call, or null when absent.').nullable(),
  resource: z.string().describe('The Fidel API resource path that handled the request.'),
  status: z.int().describe('The upstream HTTP status code returned by Fidel.'),
  executionMs: z.number().describe('The upstream execution time in milliseconds when Fidel returned it.').nullable(),
}).describe('The normalized result of listing Fidel brands.')

export const getBrandInput = z.strictObject({
  brandId: z.string().min(1).describe('The Fidel brand ID to fetch.'),
}).describe('The Fidel brand lookup input.')

export const getBrandOutput = z.strictObject({
  brand: z.strictObject({
    id: z.string().describe('The Fidel brand ID.'),
    accountId: z.string().describe('The Fidel account ID that owns the brand.').nullable(),
    created: z.string().describe('The ISO timestamp when the brand was created.').nullable(),
    updated: z.string().describe('The ISO timestamp when the brand was last updated.').nullable(),
    name: z.string().describe('The brand display name.').nullable(),
    metadata: z.looseObject({}).describe('The optional metadata object returned by Fidel.').nullable(),
    logoUrl: z.string().describe('The brand logo URL when Fidel returned one.').nullable(),
    live: z.boolean().describe('Whether the brand belongs to the live environment.').nullable(),
    consent: z.boolean().describe('Whether the brand requires cardholder consent.').nullable(),
    websiteUrl: z.string().describe('The brand website URL when Fidel returned one.').nullable(),
  }).describe('A Fidel brand record normalized by the connector.'),
  resource: z.string().describe('The Fidel API resource path that handled the request.'),
  status: z.int().describe('The upstream HTTP status code returned by Fidel.'),
  executionMs: z.number().describe('The upstream execution time in milliseconds when Fidel returned it.').nullable(),
}).describe('The normalized result of fetching one Fidel brand.')

export const listCardsInput = z.strictObject({
  programId: z.string().min(1).describe('The Fidel program ID whose cards you want to list.'),
  limit: z.int().min(1).describe('The maximum number of cards to return.').optional(),
  start: z.string().min(1).describe('The opaque cursor string returned as nextCursor by a previous Fidel list action. Pass it back unchanged.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort order for the upstream created or datetime field.').optional(),
}).describe('The Fidel card list input.')

export const listCardsOutput = z.strictObject({
  count: z.int().describe('The number of cards returned by Fidel.'),
  cards: z.array(z.strictObject({
    id: z.string().describe('The Fidel card ID.'),
    accountId: z.string().describe('The Fidel account ID that owns the card.').nullable(),
    countryCode: z.string().describe('The ISO alpha-3 country code for the card.').nullable(),
    created: z.string().describe('The ISO timestamp when the card was created.').nullable(),
    expYear: z.int().describe('The card expiration year.').nullable(),
    expDate: z.string().describe('The ISO date for the card expiration month.').nullable(),
    live: z.boolean().describe('Whether the card belongs to the live environment.').nullable(),
    lastNumbers: z.string().describe('The last four card digits.').nullable(),
    expMonth: z.int().describe('The card expiration month.').nullable(),
    updated: z.string().describe('The ISO timestamp when the card was last updated.').nullable(),
    programId: z.string().describe('The Fidel program ID that owns the card.').nullable(),
    firstNumbers: z.string().describe('The first six card digits.').nullable(),
    scheme: z.string().describe('The card network reported by Fidel.').nullable(),
    type: z.string().describe('The card type reported by Fidel.').nullable(),
  }).describe('A Fidel card record normalized by the connector.')).describe('The card records returned by Fidel.'),
  nextCursor: z.string().describe('The cursor string to pass back as start in the next list_cards call, or null when absent.').nullable(),
  resource: z.string().describe('The Fidel API resource path that handled the request.'),
  status: z.int().describe('The upstream HTTP status code returned by Fidel.'),
  executionMs: z.number().describe('The upstream execution time in milliseconds when Fidel returned it.').nullable(),
}).describe('The normalized result of listing Fidel cards.')

export const getCardInput = z.strictObject({
  cardId: z.string().min(1).describe('The Fidel card ID to fetch.'),
}).describe('The Fidel card lookup input.')

export const getCardOutput = z.strictObject({
  card: z.strictObject({
    id: z.string().describe('The Fidel card ID.'),
    accountId: z.string().describe('The Fidel account ID that owns the card.').nullable(),
    countryCode: z.string().describe('The ISO alpha-3 country code for the card.').nullable(),
    created: z.string().describe('The ISO timestamp when the card was created.').nullable(),
    expYear: z.int().describe('The card expiration year.').nullable(),
    expDate: z.string().describe('The ISO date for the card expiration month.').nullable(),
    live: z.boolean().describe('Whether the card belongs to the live environment.').nullable(),
    lastNumbers: z.string().describe('The last four card digits.').nullable(),
    expMonth: z.int().describe('The card expiration month.').nullable(),
    updated: z.string().describe('The ISO timestamp when the card was last updated.').nullable(),
    programId: z.string().describe('The Fidel program ID that owns the card.').nullable(),
    firstNumbers: z.string().describe('The first six card digits.').nullable(),
    scheme: z.string().describe('The card network reported by Fidel.').nullable(),
    type: z.string().describe('The card type reported by Fidel.').nullable(),
  }).describe('A Fidel card record normalized by the connector.'),
  resource: z.string().describe('The Fidel API resource path that handled the request.'),
  status: z.int().describe('The upstream HTTP status code returned by Fidel.'),
  executionMs: z.number().describe('The upstream execution time in milliseconds when Fidel returned it.').nullable(),
}).describe('The normalized result of fetching one Fidel card.')

export const listTransactionsInput = z.strictObject({
  programId: z.string().min(1).describe('The Fidel program ID whose transactions you want to list.'),
  limit: z.int().min(1).describe('The maximum number of transactions to return.').optional(),
  start: z.string().min(1).describe('The opaque cursor string returned as nextCursor by a previous Fidel list action. Pass it back unchanged.').optional(),
  order: z.enum(['asc', 'desc']).describe('Sort order for the upstream created or datetime field.').optional(),
  from: z.iso.datetime({ offset: true }).min(1).describe('The inclusive starting ISO date-time filter.').optional(),
  to: z.iso.datetime({ offset: true }).min(1).describe('The inclusive ending ISO date-time filter.').optional(),
}).describe('The Fidel transaction list input.')

export const listTransactionsOutput = z.strictObject({
  count: z.int().describe('The number of transactions returned by Fidel.'),
  transactions: z.array(z.strictObject({
    id: z.string().describe('The Fidel transaction ID.'),
    programId: z.string().describe('The Fidel program ID that owns the transaction.').nullable(),
    accountId: z.string().describe('The Fidel account ID that owns the transaction.').nullable(),
    created: z.string().describe('The ISO timestamp when the transaction was created.').nullable(),
    updated: z.string().describe('The ISO timestamp when the transaction was last updated.').nullable(),
    amount: z.number().describe('The transaction amount.').nullable(),
    currency: z.string().describe('The ISO currency code for the transaction.').nullable(),
    authorizationCode: z.string().describe('The normalized authorization or approval code returned by Fidel.').nullable(),
    auth: z.boolean().describe('Whether Fidel classified the event as an authorization.').nullable(),
    cleared: z.boolean().describe('Whether Fidel classified the event as cleared.').nullable(),
    wallet: z.looseObject({}).describe('The optional wallet object returned by Fidel.').nullable(),
    offer: z.looseObject({}).describe('The optional offer object returned by Fidel.').nullable(),
    datetime: z.string().describe('The upstream transaction datetime string returned by Fidel.').nullable(),
    card: z.strictObject({
      id: z.string().describe('The Fidel card ID.').nullable(),
      firstNumbers: z.string().describe('The first six card digits.').nullable(),
      lastNumbers: z.string().describe('The last four card digits.').nullable(),
      scheme: z.string().describe('The card network reported by Fidel.').nullable(),
    }).describe('The card snapshot nested inside a Fidel transaction.'),
    location: z.strictObject({
      id: z.string().describe('The Fidel location ID.').nullable(),
      address: z.string().describe('The location street address.').nullable(),
      city: z.string().describe('The location city.').nullable(),
      countryCode: z.string().describe('The ISO alpha-3 country code for the location.').nullable(),
      geolocation: z.strictObject({
        latitude: z.number().describe('The latitude coordinate.').nullable(),
        longitude: z.number().describe('The longitude coordinate.').nullable(),
      }).describe('The optional latitude and longitude returned by Fidel for this location.').nullable(),
      postcode: z.string().describe('The location postal code.').nullable(),
      state: z.string().describe('The location state or region field returned by Fidel.').nullable(),
      timezone: z.string().describe('The IANA timezone for the location.').nullable(),
      metadata: z.looseObject({}).describe('The optional metadata object returned by Fidel.').nullable(),
    }).describe('The location snapshot nested inside a Fidel transaction.'),
    brand: z.strictObject({
      id: z.string().describe('The Fidel brand ID.').nullable(),
      name: z.string().describe('The brand name.').nullable(),
      logoUrl: z.string().describe('The brand logo URL when Fidel returned one.').nullable(),
      metadata: z.looseObject({}).describe('The optional metadata object returned by Fidel.').nullable(),
    }).describe('The brand snapshot nested inside a Fidel transaction.'),
    identifiers: z.strictObject({
      amexApprovalCode: z.string().describe('The American Express approval code when Fidel returned one.').nullable(),
      mastercardAuthCode: z.string().describe('The Mastercard authorization code when Fidel returned one.').nullable(),
      mastercardRefNumber: z.string().describe('The Mastercard reference number when Fidel returned one.').nullable(),
      mastercardTransactionSequenceNumber: z.string().describe('The Mastercard transaction sequence number when Fidel returned one.').nullable(),
      mid: z.string().describe('The merchant identifier returned by Fidel.').nullable(),
      visaAuthCode: z.string().describe('The Visa authorization code when Fidel returned one.').nullable(),
    }).describe('Network-specific identifiers returned by Fidel for a transaction.'),
    cardPresent: z.boolean().describe('Whether Fidel marked the transaction as card present.').nullable(),
  }).describe('A Fidel transaction record normalized by the connector.')).describe('The transaction records returned by Fidel.'),
  nextCursor: z.string().describe('The cursor string to pass back as start in the next list_transactions call, or null when absent.').nullable(),
  resource: z.string().describe('The Fidel API resource path that handled the request.'),
  status: z.int().describe('The upstream HTTP status code returned by Fidel.'),
  executionMs: z.number().describe('The upstream execution time in milliseconds when Fidel returned it.').nullable(),
}).describe('The normalized result of listing Fidel transactions for one program.')

export const getTransactionInput = z.strictObject({
  transactionId: z.string().min(1).describe('The Fidel transaction ID to fetch.'),
}).describe('The Fidel transaction lookup input.')

export const getTransactionOutput = z.strictObject({
  transaction: z.strictObject({
    id: z.string().describe('The Fidel transaction ID.'),
    programId: z.string().describe('The Fidel program ID that owns the transaction.').nullable(),
    accountId: z.string().describe('The Fidel account ID that owns the transaction.').nullable(),
    created: z.string().describe('The ISO timestamp when the transaction was created.').nullable(),
    updated: z.string().describe('The ISO timestamp when the transaction was last updated.').nullable(),
    amount: z.number().describe('The transaction amount.').nullable(),
    currency: z.string().describe('The ISO currency code for the transaction.').nullable(),
    authorizationCode: z.string().describe('The normalized authorization or approval code returned by Fidel.').nullable(),
    auth: z.boolean().describe('Whether Fidel classified the event as an authorization.').nullable(),
    cleared: z.boolean().describe('Whether Fidel classified the event as cleared.').nullable(),
    wallet: z.looseObject({}).describe('The optional wallet object returned by Fidel.').nullable(),
    offer: z.looseObject({}).describe('The optional offer object returned by Fidel.').nullable(),
    datetime: z.string().describe('The upstream transaction datetime string returned by Fidel.').nullable(),
    card: z.strictObject({
      id: z.string().describe('The Fidel card ID.').nullable(),
      firstNumbers: z.string().describe('The first six card digits.').nullable(),
      lastNumbers: z.string().describe('The last four card digits.').nullable(),
      scheme: z.string().describe('The card network reported by Fidel.').nullable(),
    }).describe('The card snapshot nested inside a Fidel transaction.'),
    location: z.strictObject({
      id: z.string().describe('The Fidel location ID.').nullable(),
      address: z.string().describe('The location street address.').nullable(),
      city: z.string().describe('The location city.').nullable(),
      countryCode: z.string().describe('The ISO alpha-3 country code for the location.').nullable(),
      geolocation: z.strictObject({
        latitude: z.number().describe('The latitude coordinate.').nullable(),
        longitude: z.number().describe('The longitude coordinate.').nullable(),
      }).describe('The optional latitude and longitude returned by Fidel for this location.').nullable(),
      postcode: z.string().describe('The location postal code.').nullable(),
      state: z.string().describe('The location state or region field returned by Fidel.').nullable(),
      timezone: z.string().describe('The IANA timezone for the location.').nullable(),
      metadata: z.looseObject({}).describe('The optional metadata object returned by Fidel.').nullable(),
    }).describe('The location snapshot nested inside a Fidel transaction.'),
    brand: z.strictObject({
      id: z.string().describe('The Fidel brand ID.').nullable(),
      name: z.string().describe('The brand name.').nullable(),
      logoUrl: z.string().describe('The brand logo URL when Fidel returned one.').nullable(),
      metadata: z.looseObject({}).describe('The optional metadata object returned by Fidel.').nullable(),
    }).describe('The brand snapshot nested inside a Fidel transaction.'),
    identifiers: z.strictObject({
      amexApprovalCode: z.string().describe('The American Express approval code when Fidel returned one.').nullable(),
      mastercardAuthCode: z.string().describe('The Mastercard authorization code when Fidel returned one.').nullable(),
      mastercardRefNumber: z.string().describe('The Mastercard reference number when Fidel returned one.').nullable(),
      mastercardTransactionSequenceNumber: z.string().describe('The Mastercard transaction sequence number when Fidel returned one.').nullable(),
      mid: z.string().describe('The merchant identifier returned by Fidel.').nullable(),
      visaAuthCode: z.string().describe('The Visa authorization code when Fidel returned one.').nullable(),
    }).describe('Network-specific identifiers returned by Fidel for a transaction.'),
    cardPresent: z.boolean().describe('Whether Fidel marked the transaction as card present.').nullable(),
  }).describe('A Fidel transaction record normalized by the connector.'),
  resource: z.string().describe('The Fidel API resource path that handled the request.'),
  status: z.int().describe('The upstream HTTP status code returned by Fidel.'),
  executionMs: z.number().describe('The upstream execution time in milliseconds when Fidel returned it.').nullable(),
}).describe('The normalized result of fetching one Fidel transaction.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const fidelApiActions = {
  list_brands: {
    description: 'List Fidel brands available to the connected secret API key.',
    effect: 'read',
    inputSchema: listBrandsInput,
    outputSchema: z.toJSONSchema(listBrandsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_brand: {
    description: 'Fetch one Fidel brand by brand ID.',
    effect: 'read',
    inputSchema: getBrandInput,
    outputSchema: z.toJSONSchema(getBrandOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_cards: {
    description: 'List Fidel cards for one program ID.',
    effect: 'read',
    inputSchema: listCardsInput,
    outputSchema: z.toJSONSchema(listCardsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_card: {
    description: 'Fetch one Fidel card by card ID.',
    effect: 'read',
    inputSchema: getCardInput,
    outputSchema: z.toJSONSchema(getCardOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_transactions: {
    description: 'List Fidel transactions for one program ID.',
    effect: 'read',
    inputSchema: listTransactionsInput,
    outputSchema: z.toJSONSchema(listTransactionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_transaction: {
    description: 'Fetch one Fidel transaction by transaction ID.',
    effect: 'read',
    inputSchema: getTransactionInput,
    outputSchema: z.toJSONSchema(getTransactionOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
