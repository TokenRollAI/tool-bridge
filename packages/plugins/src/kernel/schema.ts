/**
 * Kernel 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const listBrowserSessionsInput = z.strictObject({
  status: z.enum(['active', 'deleted', 'all']).describe('Filter sessions by status.').optional(),
  limit: z.int().min(1).max(100).describe('Maximum number of results to return.').optional(),
  offset: z.int().min(0).describe('Number of results to skip.').optional(),
  query: z.string().min(1).describe('Search browsers by name, session ID, profile ID, proxy ID, or pool name.').optional(),
  tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').optional(),
}).describe('Parameters for listing Kernel browser sessions.')

export const listBrowserSessionsOutput = z.strictObject({
  browser_sessions: z.array(z.looseObject({
    created_at: z.iso.datetime({ offset: true }).describe('When the browser session was created.').optional(),
    cdp_ws_url: z.string().describe('WebSocket URL for Chrome DevTools Protocol connections to the browser session.').optional(),
    webdriver_ws_url: z.string().describe('WebSocket URL for WebDriver BiDi connections to the browser session.').optional(),
    browser_live_view_url: z.string().describe('Remote URL for live viewing the browser session, when available.').optional(),
    base_url: z.string().describe('Metro-API HTTP base URL for this browser session.').optional(),
    headless: z.boolean().describe('Whether the browser session is running in headless mode.').optional(),
    stealth: z.boolean().describe('Whether the browser session is running in stealth mode.').optional(),
    gpu: z.boolean().describe('Whether GPU acceleration is enabled for the browser session.').optional(),
    session_id: z.string().min(1).describe('Unique identifier for the browser session.').optional(),
    name: z.string().describe('Human-readable browser session name, when one was set.').nullable().optional(),
    timeout_seconds: z.int().describe('The inactivity timeout in seconds for the browser session.').optional(),
    profile: z.strictObject({
      id: z.string().min(1).describe('The Kernel profile ID.').optional(),
      name: z.string().min(1).describe('The Kernel profile name.').optional(),
      save_changes: z.boolean().describe('Whether Kernel should save browser state changes back to the profile.').optional(),
    }).describe('Kernel browser profile reference.').optional(),
    proxy_id: z.string().describe('ID of the proxy associated with this browser session, if any.').nullable().optional(),
    pool: z.looseObject({
      id: z.string().min(1).describe('The Kernel browser pool ID.').optional(),
      name: z.string().describe('The Kernel browser pool name.').optional(),
    }).describe('Kernel browser pool reference.').optional(),
    viewport: z.strictObject({
      width: z.int().min(1).describe('Viewport width in pixels.').optional(),
      height: z.int().min(1).describe('Viewport height in pixels.').optional(),
    }).describe('Viewport configuration for a Kernel browser session.').optional(),
    kiosk_mode: z.boolean().describe('Whether the browser session is running in kiosk mode.').optional(),
    start_url: z.string().describe('URL the session was asked to navigate to on creation, if any.').nullable().optional(),
    chrome_policy: z.looseObject({}).describe('Chrome enterprise policy overrides for the session.').optional(),
    tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').optional(),
    deleted_at: z.iso.datetime({ offset: true }).describe('When the browser session was soft-deleted.').optional(),
    usage: z.looseObject({
      runtime_seconds: z.int().describe('The browser session runtime in seconds.').optional(),
    }).describe('Kernel browser usage metadata.').optional(),
    telemetry: z.looseObject({}).describe('Kernel browser telemetry configuration.').nullable().optional(),
  }).describe('A Kernel browser session.')).describe('Kernel browser sessions.').optional(),
  pagination: z.strictObject({
    limit: z.int().describe('The limit used for pagination.').optional(),
    offset: z.int().describe('The offset used for pagination.').optional(),
    has_more: z.boolean().describe('Whether more results are available.').optional(),
    next_offset: z.int().describe('The offset where the next page starts.').optional(),
  }).describe('Kernel pagination metadata parsed from response headers.').optional(),
}).describe('The Kernel browser sessions returned by the API.')

export const createBrowserSessionInput = z.strictObject({
  invocation_id: z.string().min(1).describe('The Kernel action invocation ID to associate with the session.').optional(),
  name: z.string().min(1).max(255).regex(new RegExp('^[a-zA-Z0-9._-]{1,255}$')).describe('Optional human-readable name for the browser session.').optional(),
  tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').optional(),
  stealth: z.boolean().describe('Whether to launch the browser in stealth mode.').optional(),
  headless: z.boolean().describe('Whether to launch the browser using a headless image.').optional(),
  gpu: z.boolean().describe('Whether to enable GPU acceleration for the browser session.').optional(),
  timeout_seconds: z.int().min(10).max(259200).describe('The inactivity timeout in seconds.').optional(),
  profile: z.strictObject({
    id: z.string().min(1).describe('The Kernel profile ID to load.').optional(),
    name: z.string().min(1).describe('The Kernel profile name to load.').optional(),
    save_changes: z.boolean().describe('Whether Kernel should save browser state changes back to the profile.').optional(),
  }).describe('Profile to load into the Kernel browser session.').optional(),
  extensions: z.array(z.strictObject({
    id: z.string().min(1).describe('The Kernel extension ID to load.').optional(),
    name: z.string().min(1).describe('The Kernel extension name to load.').optional(),
  }).describe('Browser extension to load into the Kernel browser session.')).max(20).describe('Browser extensions to load into the session.').optional(),
  proxy_id: z.string().min(1).describe('The Kernel proxy ID to associate with the browser session.').optional(),
  viewport: z.strictObject({
    width: z.int().min(1).describe('Viewport width in pixels.').optional(),
    height: z.int().min(1).describe('Viewport height in pixels.').optional(),
  }).describe('Viewport configuration for a Kernel browser session.').optional(),
  kiosk_mode: z.boolean().describe('Whether to launch the browser in kiosk mode.').optional(),
  start_url: z.url().describe('Optional URL to open when the browser session is created.').optional(),
  chrome_policy: z.looseObject({}).describe('Chrome enterprise policy overrides for the session.').optional(),
  telemetry: z.looseObject({}).describe('Kernel telemetry request configuration.').nullable().optional(),
}).describe('Parameters for creating a Kernel browser session.')

export const createBrowserSessionOutput = z.strictObject({
  browser_session: z.looseObject({
    created_at: z.iso.datetime({ offset: true }).describe('When the browser session was created.').optional(),
    cdp_ws_url: z.string().describe('WebSocket URL for Chrome DevTools Protocol connections to the browser session.').optional(),
    webdriver_ws_url: z.string().describe('WebSocket URL for WebDriver BiDi connections to the browser session.').optional(),
    browser_live_view_url: z.string().describe('Remote URL for live viewing the browser session, when available.').optional(),
    base_url: z.string().describe('Metro-API HTTP base URL for this browser session.').optional(),
    headless: z.boolean().describe('Whether the browser session is running in headless mode.').optional(),
    stealth: z.boolean().describe('Whether the browser session is running in stealth mode.').optional(),
    gpu: z.boolean().describe('Whether GPU acceleration is enabled for the browser session.').optional(),
    session_id: z.string().min(1).describe('Unique identifier for the browser session.').optional(),
    name: z.string().describe('Human-readable browser session name, when one was set.').nullable().optional(),
    timeout_seconds: z.int().describe('The inactivity timeout in seconds for the browser session.').optional(),
    profile: z.strictObject({
      id: z.string().min(1).describe('The Kernel profile ID.').optional(),
      name: z.string().min(1).describe('The Kernel profile name.').optional(),
      save_changes: z.boolean().describe('Whether Kernel should save browser state changes back to the profile.').optional(),
    }).describe('Kernel browser profile reference.').optional(),
    proxy_id: z.string().describe('ID of the proxy associated with this browser session, if any.').nullable().optional(),
    pool: z.looseObject({
      id: z.string().min(1).describe('The Kernel browser pool ID.').optional(),
      name: z.string().describe('The Kernel browser pool name.').optional(),
    }).describe('Kernel browser pool reference.').optional(),
    viewport: z.strictObject({
      width: z.int().min(1).describe('Viewport width in pixels.').optional(),
      height: z.int().min(1).describe('Viewport height in pixels.').optional(),
    }).describe('Viewport configuration for a Kernel browser session.').optional(),
    kiosk_mode: z.boolean().describe('Whether the browser session is running in kiosk mode.').optional(),
    start_url: z.string().describe('URL the session was asked to navigate to on creation, if any.').nullable().optional(),
    chrome_policy: z.looseObject({}).describe('Chrome enterprise policy overrides for the session.').optional(),
    tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').optional(),
    deleted_at: z.iso.datetime({ offset: true }).describe('When the browser session was soft-deleted.').optional(),
    usage: z.looseObject({
      runtime_seconds: z.int().describe('The browser session runtime in seconds.').optional(),
    }).describe('Kernel browser usage metadata.').optional(),
    telemetry: z.looseObject({}).describe('Kernel browser telemetry configuration.').nullable().optional(),
  }).describe('A Kernel browser session.').optional(),
}).describe('The Kernel browser session creation response.')

export const getBrowserSessionInput = z.strictObject({
  id_or_name: z.string().min(1).describe('The Kernel browser session ID or name.'),
  include_deleted: z.boolean().describe('Whether to include soft-deleted browser sessions in the lookup.').optional(),
}).describe('Parameters for retrieving one Kernel browser session.')

export const getBrowserSessionOutput = z.strictObject({
  browser_session: z.looseObject({
    created_at: z.iso.datetime({ offset: true }).describe('When the browser session was created.').optional(),
    cdp_ws_url: z.string().describe('WebSocket URL for Chrome DevTools Protocol connections to the browser session.').optional(),
    webdriver_ws_url: z.string().describe('WebSocket URL for WebDriver BiDi connections to the browser session.').optional(),
    browser_live_view_url: z.string().describe('Remote URL for live viewing the browser session, when available.').optional(),
    base_url: z.string().describe('Metro-API HTTP base URL for this browser session.').optional(),
    headless: z.boolean().describe('Whether the browser session is running in headless mode.').optional(),
    stealth: z.boolean().describe('Whether the browser session is running in stealth mode.').optional(),
    gpu: z.boolean().describe('Whether GPU acceleration is enabled for the browser session.').optional(),
    session_id: z.string().min(1).describe('Unique identifier for the browser session.').optional(),
    name: z.string().describe('Human-readable browser session name, when one was set.').nullable().optional(),
    timeout_seconds: z.int().describe('The inactivity timeout in seconds for the browser session.').optional(),
    profile: z.strictObject({
      id: z.string().min(1).describe('The Kernel profile ID.').optional(),
      name: z.string().min(1).describe('The Kernel profile name.').optional(),
      save_changes: z.boolean().describe('Whether Kernel should save browser state changes back to the profile.').optional(),
    }).describe('Kernel browser profile reference.').optional(),
    proxy_id: z.string().describe('ID of the proxy associated with this browser session, if any.').nullable().optional(),
    pool: z.looseObject({
      id: z.string().min(1).describe('The Kernel browser pool ID.').optional(),
      name: z.string().describe('The Kernel browser pool name.').optional(),
    }).describe('Kernel browser pool reference.').optional(),
    viewport: z.strictObject({
      width: z.int().min(1).describe('Viewport width in pixels.').optional(),
      height: z.int().min(1).describe('Viewport height in pixels.').optional(),
    }).describe('Viewport configuration for a Kernel browser session.').optional(),
    kiosk_mode: z.boolean().describe('Whether the browser session is running in kiosk mode.').optional(),
    start_url: z.string().describe('URL the session was asked to navigate to on creation, if any.').nullable().optional(),
    chrome_policy: z.looseObject({}).describe('Chrome enterprise policy overrides for the session.').optional(),
    tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').optional(),
    deleted_at: z.iso.datetime({ offset: true }).describe('When the browser session was soft-deleted.').optional(),
    usage: z.looseObject({
      runtime_seconds: z.int().describe('The browser session runtime in seconds.').optional(),
    }).describe('Kernel browser usage metadata.').optional(),
    telemetry: z.looseObject({}).describe('Kernel browser telemetry configuration.').nullable().optional(),
  }).describe('A Kernel browser session.').optional(),
}).describe('The Kernel browser session lookup response.')

export const updateBrowserSessionInput = z.strictObject({
  id_or_name: z.string().min(1).describe('The Kernel browser session ID or name.'),
  name: z.string().describe('Human-readable name for the browser session, or null to clear it.').nullable().optional(),
  tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').nullable().optional(),
  proxy_id: z.string().describe('Kernel proxy ID to use, or an empty string to remove proxy.').nullable().optional(),
  disable_default_proxy: z.boolean().describe('Whether stealth browsers should connect directly instead of using the default stealth proxy.').optional(),
  profile: z.strictObject({
    id: z.string().min(1).describe('The Kernel profile ID to load.').optional(),
    name: z.string().min(1).describe('The Kernel profile name to load.').optional(),
    save_changes: z.boolean().describe('Whether Kernel should save browser state changes back to the profile.').optional(),
  }).describe('Profile to load into the Kernel browser session.').optional(),
  viewport: z.strictObject({
    width: z.int().min(1).describe('Viewport width in pixels.').optional(),
    height: z.int().min(1).describe('Viewport height in pixels.').optional(),
  }).describe('Viewport configuration for a Kernel browser session.').optional(),
  telemetry: z.looseObject({}).describe('Kernel telemetry request configuration.').nullable().optional(),
}).describe('Parameters for updating a Kernel browser session.')

export const updateBrowserSessionOutput = z.strictObject({
  browser_session: z.looseObject({
    created_at: z.iso.datetime({ offset: true }).describe('When the browser session was created.').optional(),
    cdp_ws_url: z.string().describe('WebSocket URL for Chrome DevTools Protocol connections to the browser session.').optional(),
    webdriver_ws_url: z.string().describe('WebSocket URL for WebDriver BiDi connections to the browser session.').optional(),
    browser_live_view_url: z.string().describe('Remote URL for live viewing the browser session, when available.').optional(),
    base_url: z.string().describe('Metro-API HTTP base URL for this browser session.').optional(),
    headless: z.boolean().describe('Whether the browser session is running in headless mode.').optional(),
    stealth: z.boolean().describe('Whether the browser session is running in stealth mode.').optional(),
    gpu: z.boolean().describe('Whether GPU acceleration is enabled for the browser session.').optional(),
    session_id: z.string().min(1).describe('Unique identifier for the browser session.').optional(),
    name: z.string().describe('Human-readable browser session name, when one was set.').nullable().optional(),
    timeout_seconds: z.int().describe('The inactivity timeout in seconds for the browser session.').optional(),
    profile: z.strictObject({
      id: z.string().min(1).describe('The Kernel profile ID.').optional(),
      name: z.string().min(1).describe('The Kernel profile name.').optional(),
      save_changes: z.boolean().describe('Whether Kernel should save browser state changes back to the profile.').optional(),
    }).describe('Kernel browser profile reference.').optional(),
    proxy_id: z.string().describe('ID of the proxy associated with this browser session, if any.').nullable().optional(),
    pool: z.looseObject({
      id: z.string().min(1).describe('The Kernel browser pool ID.').optional(),
      name: z.string().describe('The Kernel browser pool name.').optional(),
    }).describe('Kernel browser pool reference.').optional(),
    viewport: z.strictObject({
      width: z.int().min(1).describe('Viewport width in pixels.').optional(),
      height: z.int().min(1).describe('Viewport height in pixels.').optional(),
    }).describe('Viewport configuration for a Kernel browser session.').optional(),
    kiosk_mode: z.boolean().describe('Whether the browser session is running in kiosk mode.').optional(),
    start_url: z.string().describe('URL the session was asked to navigate to on creation, if any.').nullable().optional(),
    chrome_policy: z.looseObject({}).describe('Chrome enterprise policy overrides for the session.').optional(),
    tags: z.record(z.string(), z.string().describe('A Kernel tag value.')).describe('Kernel browser session tags keyed by tag name. Values are serialized as tags[key] query parameters for list filtering.').optional(),
    deleted_at: z.iso.datetime({ offset: true }).describe('When the browser session was soft-deleted.').optional(),
    usage: z.looseObject({
      runtime_seconds: z.int().describe('The browser session runtime in seconds.').optional(),
    }).describe('Kernel browser usage metadata.').optional(),
    telemetry: z.looseObject({}).describe('Kernel browser telemetry configuration.').nullable().optional(),
  }).describe('A Kernel browser session.').optional(),
}).describe('The Kernel browser session update response.')

export const deleteBrowserSessionInput = z.strictObject({
  id_or_name: z.string().min(1).describe('The Kernel browser session ID or name.').optional(),
}).describe('Input for selecting one Kernel browser session.')

export const deleteBrowserSessionOutput = z.strictObject({
  deleted: z.boolean().describe('Whether Kernel accepted the delete request.').optional(),
}).describe('The normalized Kernel browser session deletion result.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const kernelActions = {
  list_browser_sessions: {
    description: 'List Kernel browser sessions with pagination, search, status, and tag filters.',
    effect: 'read',
    inputSchema: listBrowserSessionsInput,
    outputSchema: z.toJSONSchema(listBrowserSessionsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_browser_session: {
    description: 'Create a Kernel browser session and return its connection URLs and metadata.',
    effect: 'write',
    inputSchema: createBrowserSessionInput,
    outputSchema: z.toJSONSchema(createBrowserSessionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_browser_session: {
    description: 'Get one Kernel browser session by session ID or name.',
    effect: 'read',
    inputSchema: getBrowserSessionInput,
    outputSchema: z.toJSONSchema(getBrowserSessionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_browser_session: {
    description: 'Update mutable Kernel browser session metadata and settings.',
    effect: 'write',
    inputSchema: updateBrowserSessionInput,
    outputSchema: z.toJSONSchema(updateBrowserSessionOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_browser_session: {
    description: 'Delete a Kernel browser session by session ID or name.',
    effect: 'destructive',
    inputSchema: deleteBrowserSessionInput,
    outputSchema: z.toJSONSchema(deleteBrowserSessionOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
