/**
 * Bookingmood 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listProductsInput = z.strictObject({
  select: z.string().min(1).describe('Columns to select from the products endpoint.').optional(),
  limit: z.int().min(1).describe('Maximum number of products to return.').optional(),
  offset: z.int().min(0).describe('Number of products to skip before returning results.').optional(),
  order: z.string().min(1).describe('PostgREST order expression for products, such as created_at.desc or updated_at.asc.').optional(),
  id: z.string().min(1).describe('PostgREST filter for a specific product ID.').optional(),
  organization_id: z.string().min(1).describe('PostgREST filter for a specific organization ID.').optional(),
}).describe('Query parameters for listing Bookingmood products.')

export const listProductsOutput = z.strictObject({
  products: z.array(z.looseObject({
    id: z.string().describe('The unique product identifier.').optional(),
    organization_id: z.string().describe('The organization identifier that owns the product.').optional(),
    name: z.unknown().describe('The localized product name returned by Bookingmood.').optional(),
    timezone: z.string().describe('The product timezone.').optional(),
    rent_period: z.string().describe('The product rent period.').optional(),
    created_at: z.string().describe('The product creation timestamp returned by Bookingmood.').optional(),
    updated_at: z.string().describe('The product update timestamp returned by Bookingmood.').optional(),
  }).describe('A Bookingmood product object.')).describe('Product records returned by Bookingmood.'),
}).describe('Bookingmood products returned by the API.')

export const listBookingsInput = z.strictObject({
  select: z.string().min(1).describe('Columns to select from the bookings endpoint.').optional(),
  limit: z.int().min(1).describe('Maximum number of bookings to return.').optional(),
  offset: z.int().min(0).describe('Number of bookings to skip before returning results.').optional(),
  order: z.string().min(1).describe('PostgREST order expression for bookings, such as created_at.desc or updated_at.asc.').optional(),
  id: z.string().min(1).describe('PostgREST filter for a specific booking ID.').optional(),
  organization_id: z.string().min(1).describe('PostgREST filter for a specific organization ID.').optional(),
  product_id: z.string().min(1).describe('PostgREST filter for bookings related to a product ID.').optional(),
}).describe('Query parameters for listing Bookingmood bookings.')

export const listBookingsOutput = z.strictObject({
  bookings: z.array(z.looseObject({
    id: z.string().describe('The unique booking identifier.').optional(),
    organization_id: z.string().describe('The organization identifier that owns the booking.').optional(),
    product_id: z.string().describe('The product identifier associated with the booking.').optional(),
    status: z.string().describe('The booking status returned by Bookingmood.').optional(),
    start_at: z.string().describe('The booking start timestamp returned by Bookingmood.').optional(),
    end_at: z.string().describe('The booking end timestamp returned by Bookingmood.').optional(),
    created_at: z.string().describe('The booking creation timestamp returned by Bookingmood.').optional(),
    updated_at: z.string().describe('The booking update timestamp returned by Bookingmood.').optional(),
  }).describe('A Bookingmood booking object.')).describe('Booking records returned by Bookingmood.'),
}).describe('Bookingmood bookings returned by the API.')

export const queryAvailabilityInput = z.strictObject({
  product_id: z.uuid().describe('Bookingmood product ID to query availability for.'),
  start: z.iso.date().describe('Start date for the availability window.').optional(),
  end: z.iso.date().describe('End date for the availability window.').optional(),
}).describe('Query parameters for fetching Bookingmood availability for one product.')

export const queryAvailabilityOutput = z.strictObject({
  availability: z.array(z.looseObject({
    date: z.string().describe('The date or interval key returned by Bookingmood.').optional(),
    available: z.boolean().describe('Whether the product is available for the interval.').optional(),
  }).describe('A Bookingmood availability entry.')).describe('Availability entries returned by Bookingmood.'),
  raw: z.unknown().describe('Raw availability payload returned by Bookingmood.'),
}).describe('Bookingmood availability returned for the requested product.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const bookingmoodActions = {
  list_products: {
    description: 'List Bookingmood products with optional PostgREST select, pagination, ordering, and ID filters.',
    effect: 'read',
    inputSchema: listProductsInput,
    outputSchema: z.toJSONSchema(listProductsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_bookings: {
    description: 'List Bookingmood bookings with optional PostgREST select, pagination, ordering, and ID filters.',
    effect: 'read',
    inputSchema: listBookingsInput,
    outputSchema: z.toJSONSchema(listBookingsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  query_availability: {
    description: 'Fetch Bookingmood availability for a product using the official availability endpoint.',
    effect: 'write',
    inputSchema: queryAvailabilityInput,
    outputSchema: z.toJSONSchema(queryAvailabilityOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
