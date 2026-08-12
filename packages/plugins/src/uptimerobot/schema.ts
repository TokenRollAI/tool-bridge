/**
 * UptimeRobot 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const getAccountDetailsInput = z.strictObject({}).describe('The input payload for getting UptimeRobot account details.')

export const getAccountDetailsOutput = z.strictObject({
  account: z.looseObject({
    email: z.string().describe('The email address of the connected UptimeRobot account.').optional(),
    user_id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    monitor_limit: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    monitor_interval: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    up_monitors: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    down_monitors: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    paused_monitors: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    firstname: z.string().describe('The first name of the account owner, when present.').optional(),
    registered_at: z.string().describe('The account registration timestamp returned by UptimeRobot, when present.').optional(),
  }).describe('The account details returned by the UptimeRobot API.').optional(),
}).describe('The UptimeRobot account details lookup result.')

export const listAlertContactsInput = z.strictObject({}).describe('The input payload for listing UptimeRobot alert contacts.')

export const listAlertContactsOutput = z.strictObject({
  alert_contacts: z.array(z.looseObject({
    id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    friendly_name: z.string().describe('The friendly name of the alert contact.').optional(),
    type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    value: z.string().describe('The destination value configured for the alert contact.').optional(),
  }).describe('An alert contact returned by the UptimeRobot API.')).describe('The alert contacts returned by UptimeRobot.').optional(),
  pagination: z.looseObject({
    offset: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    limit: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    total: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
  }).describe('The pagination summary returned by UptimeRobot.').nullable().optional(),
}).describe('The alert contact list returned by UptimeRobot.')

export const listMonitorsInput = z.strictObject({
  offset: z.int().min(0).describe('The zero-based pagination offset to request from UptimeRobot.').optional(),
  limit: z.int().min(1).max(50).describe('The maximum number of monitors to return from UptimeRobot.').optional(),
  search: z.string().min(1).describe('A search term applied to monitor friendly names, URLs, and types.').optional(),
  sort: z.enum(['friendly_name', 'url', 'status', 'type']).describe('The field used by UptimeRobot to sort the monitor list.').optional(),
  monitor_ids: z.array(z.int().min(1).describe('The numeric ID of the UptimeRobot monitor.')).min(1).describe('A list of monitor IDs encoded into the official monitors filter.').optional(),
  types: z.array(z.int().min(1).max(6).describe('The UptimeRobot monitor type code. Known values are 1=HTTP(s), 2=Keyword, 3=Ping, 4=Port, 5=Heartbeat, and 6=SSL.')).min(1).describe('A list of monitor type codes encoded into the official types filter.').optional(),
  statuses: z.array(z.int().min(0).describe('A UptimeRobot monitor status code.')).min(1).describe('A list of monitor status codes encoded into the official statuses filter.').optional(),
  logs: z.boolean().describe('Whether monitor logs should be included in each monitor result.').optional(),
  alert_contacts: z.boolean().describe('Whether alert contacts should be included in each monitor result.').optional(),
}).describe('The input payload for listing monitors from the UptimeRobot account.')

export const listMonitorsOutput = z.strictObject({
  monitors: z.array(z.looseObject({
    id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    friendly_name: z.string().describe('The friendly name configured for the monitor.').optional(),
    url: z.string().describe('The monitored URL, hostname, or IP address.').optional(),
    type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    sub_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    interval: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    timeout: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_value: z.string().describe('The keyword value configured for keyword monitors, when present.').optional(),
    http_username: z.string().describe('The HTTP authentication username configured for the monitor, when present.').optional(),
    http_password: z.string().describe('The HTTP authentication password configured for the monitor, when present.').optional(),
    alert_contacts: z.array(z.looseObject({
      id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      friendly_name: z.string().describe('The friendly name of the alert contact.').optional(),
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      value: z.string().describe('The destination value configured for the alert contact.').optional(),
    }).describe('An alert contact returned by the UptimeRobot API.')).describe('The alert contacts returned for the monitor, when requested.').optional(),
    logs: z.array(z.looseObject({
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      duration: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      reason: z.looseObject({}).describe('The nested reason object returned by UptimeRobot, when present.').optional(),
    }).describe('A monitor log entry returned by UptimeRobot.')).describe('The monitor logs returned by UptimeRobot, when requested.').optional(),
    create_datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
  }).describe('A monitor returned by the UptimeRobot API.')).describe('The monitors returned by UptimeRobot.').optional(),
  pagination: z.looseObject({
    offset: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    limit: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    total: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
  }).describe('The pagination summary returned by UptimeRobot.').nullable().optional(),
}).describe('The UptimeRobot monitor list.')

export const getMonitorInput = z.strictObject({
  monitor_id: z.int().min(1).describe('The numeric ID of the UptimeRobot monitor.'),
  logs: z.boolean().describe('Whether monitor logs should be included in the UptimeRobot response.').optional(),
  alert_contacts: z.boolean().describe('Whether alert contacts should be included in the UptimeRobot response.').optional(),
}).describe('The input payload for fetching a single UptimeRobot monitor.')

export const getMonitorOutput = z.strictObject({
  monitor: z.looseObject({
    id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    friendly_name: z.string().describe('The friendly name configured for the monitor.').optional(),
    url: z.string().describe('The monitored URL, hostname, or IP address.').optional(),
    type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    sub_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    interval: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    timeout: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_value: z.string().describe('The keyword value configured for keyword monitors, when present.').optional(),
    http_username: z.string().describe('The HTTP authentication username configured for the monitor, when present.').optional(),
    http_password: z.string().describe('The HTTP authentication password configured for the monitor, when present.').optional(),
    alert_contacts: z.array(z.looseObject({
      id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      friendly_name: z.string().describe('The friendly name of the alert contact.').optional(),
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      value: z.string().describe('The destination value configured for the alert contact.').optional(),
    }).describe('An alert contact returned by the UptimeRobot API.')).describe('The alert contacts returned for the monitor, when requested.').optional(),
    logs: z.array(z.looseObject({
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      duration: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      reason: z.looseObject({}).describe('The nested reason object returned by UptimeRobot, when present.').optional(),
    }).describe('A monitor log entry returned by UptimeRobot.')).describe('The monitor logs returned by UptimeRobot, when requested.').optional(),
    create_datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
  }).describe('A monitor returned by the UptimeRobot API.').optional(),
}).describe('The single-monitor lookup result returned by UptimeRobot.')

export const createMonitorInput = z.strictObject({
  friendly_name: z.string().min(1).describe('The friendly name of the monitor.'),
  url: z.string().min(1).describe('The URL, hostname, or IP address that UptimeRobot should monitor.'),
  type: z.int().min(1).max(6).describe('The UptimeRobot monitor type code. Known values are 1=HTTP(s), 2=Keyword, 3=Ping, 4=Port, 5=Heartbeat, and 6=SSL.'),
  sub_type: z.int().min(1).describe('The subtype code used for port monitors. Known values are 1=HTTP, 2=HTTPS, 3=FTP, 4=SMTP, 5=POP3, 6=IMAP, and 99=Custom.').optional(),
  port: z.int().min(1).max(65535).describe('The destination port used for custom port monitors.').optional(),
  interval: z.int().min(1).describe('The monitor interval in seconds accepted by UptimeRobot.').optional(),
  timeout: z.int().min(1).max(60).describe('The timeout in seconds before UptimeRobot treats the check as failed.').optional(),
  keyword_type: z.union([z.literal(1), z.literal(2)]).describe('The keyword matching mode. Use 1 when the keyword must exist, or 2 when it must not exist.').optional(),
  keyword_value: z.string().min(1).describe('The keyword value used by keyword monitors.').optional(),
  http_username: z.string().min(1).describe('The HTTP authentication username used by the monitor.').optional(),
  http_password: z.string().min(1).describe('The HTTP authentication password used by the monitor.').optional(),
  ssl: z.boolean().describe('Whether SSL validation should stay enabled for HTTPS-based monitors.').optional(),
  alert_contacts: z.union([z.string().min(1).describe('The official alert_contacts string, such as 12345_0_0-67890_5_2.'), z.array(z.union([z.int().min(1).describe('The numeric ID of the UptimeRobot alert contact.'), z.strictObject({
    id: z.int().min(1).describe('The numeric ID of the UptimeRobot alert contact.').optional(),
    threshold: z.int().min(0).describe('How many minutes UptimeRobot should wait before notifying this alert contact.').optional(),
    recurrence: z.int().min(0).describe('How many times UptimeRobot should repeat the notification for this alert contact.').optional(),
  }).describe('A structured alert contact assignment.')])).min(1).describe('A list of alert contacts to encode into the official alert_contacts parameter.')]).describe('Either the official alert_contacts string or a list of structured alert contact assignments.').optional(),
}).describe('The input payload for creating a UptimeRobot monitor.')

export const createMonitorOutput = z.strictObject({
  monitor: z.looseObject({
    id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    friendly_name: z.string().describe('The friendly name configured for the monitor.').optional(),
    url: z.string().describe('The monitored URL, hostname, or IP address.').optional(),
    type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    sub_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    interval: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    timeout: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_value: z.string().describe('The keyword value configured for keyword monitors, when present.').optional(),
    http_username: z.string().describe('The HTTP authentication username configured for the monitor, when present.').optional(),
    http_password: z.string().describe('The HTTP authentication password configured for the monitor, when present.').optional(),
    alert_contacts: z.array(z.looseObject({
      id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      friendly_name: z.string().describe('The friendly name of the alert contact.').optional(),
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      value: z.string().describe('The destination value configured for the alert contact.').optional(),
    }).describe('An alert contact returned by the UptimeRobot API.')).describe('The alert contacts returned for the monitor, when requested.').optional(),
    logs: z.array(z.looseObject({
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      duration: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      reason: z.looseObject({}).describe('The nested reason object returned by UptimeRobot, when present.').optional(),
    }).describe('A monitor log entry returned by UptimeRobot.')).describe('The monitor logs returned by UptimeRobot, when requested.').optional(),
    create_datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
  }).describe('A monitor returned by the UptimeRobot API.').optional(),
}).describe('The newly created UptimeRobot monitor.')

export const updateMonitorInput = z.strictObject({
  monitor_id: z.int().min(1).describe('The numeric ID of the UptimeRobot monitor.'),
  friendly_name: z.string().min(1).describe('The friendly name of the monitor.').optional(),
  url: z.string().min(1).describe('The URL, hostname, or IP address that UptimeRobot should monitor.').optional(),
  type: z.int().min(1).max(6).describe('The UptimeRobot monitor type code. Known values are 1=HTTP(s), 2=Keyword, 3=Ping, 4=Port, 5=Heartbeat, and 6=SSL.').optional(),
  sub_type: z.int().min(1).describe('The subtype code used for port monitors. Known values are 1=HTTP, 2=HTTPS, 3=FTP, 4=SMTP, 5=POP3, 6=IMAP, and 99=Custom.').optional(),
  port: z.int().min(1).max(65535).describe('The destination port used for custom port monitors.').optional(),
  interval: z.int().min(1).describe('The monitor interval in seconds accepted by UptimeRobot.').optional(),
  timeout: z.int().min(1).max(60).describe('The timeout in seconds before UptimeRobot treats the check as failed.').optional(),
  keyword_type: z.union([z.literal(1), z.literal(2)]).describe('The keyword matching mode. Use 1 when the keyword must exist, or 2 when it must not exist.').optional(),
  keyword_value: z.string().min(1).describe('The keyword value used by keyword monitors.').optional(),
  http_username: z.string().min(1).describe('The HTTP authentication username used by the monitor.').optional(),
  http_password: z.string().min(1).describe('The HTTP authentication password used by the monitor.').optional(),
  ssl: z.boolean().describe('Whether SSL validation should stay enabled for HTTPS-based monitors.').optional(),
  alert_contacts: z.union([z.string().min(1).describe('The official alert_contacts string, such as 12345_0_0-67890_5_2.'), z.array(z.union([z.int().min(1).describe('The numeric ID of the UptimeRobot alert contact.'), z.strictObject({
    id: z.int().min(1).describe('The numeric ID of the UptimeRobot alert contact.').optional(),
    threshold: z.int().min(0).describe('How many minutes UptimeRobot should wait before notifying this alert contact.').optional(),
    recurrence: z.int().min(0).describe('How many times UptimeRobot should repeat the notification for this alert contact.').optional(),
  }).describe('A structured alert contact assignment.')])).min(1).describe('A list of alert contacts to encode into the official alert_contacts parameter.')]).describe('Either the official alert_contacts string or a list of structured alert contact assignments.').optional(),
}).describe('The input payload for updating an existing UptimeRobot monitor.')

export const updateMonitorOutput = z.strictObject({
  monitor: z.looseObject({
    id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    friendly_name: z.string().describe('The friendly name configured for the monitor.').optional(),
    url: z.string().describe('The monitored URL, hostname, or IP address.').optional(),
    type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    sub_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    interval: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    timeout: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
    keyword_value: z.string().describe('The keyword value configured for keyword monitors, when present.').optional(),
    http_username: z.string().describe('The HTTP authentication username configured for the monitor, when present.').optional(),
    http_password: z.string().describe('The HTTP authentication password configured for the monitor, when present.').optional(),
    alert_contacts: z.array(z.looseObject({
      id: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      friendly_name: z.string().describe('The friendly name of the alert contact.').optional(),
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      status: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      value: z.string().describe('The destination value configured for the alert contact.').optional(),
    }).describe('An alert contact returned by the UptimeRobot API.')).describe('The alert contacts returned for the monitor, when requested.').optional(),
    logs: z.array(z.looseObject({
      type: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      duration: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
      reason: z.looseObject({}).describe('The nested reason object returned by UptimeRobot, when present.').optional(),
    }).describe('A monitor log entry returned by UptimeRobot.')).describe('The monitor logs returned by UptimeRobot, when requested.').optional(),
    create_datetime: z.union([z.int().describe('An integer numeric value.'), z.string().describe('A string numeric value.')]).describe('A numeric value returned by the UptimeRobot API.').optional(),
  }).describe('A monitor returned by the UptimeRobot API.').optional(),
}).describe('The updated UptimeRobot monitor.')

export const deleteMonitorInput = z.strictObject({
  monitor_id: z.int().min(1).describe('The numeric ID of the UptimeRobot monitor.').optional(),
}).describe('The input payload for deleting a UptimeRobot monitor.')

export const deleteMonitorOutput = z.strictObject({
  deleted: z.boolean().describe('Whether the monitor was deleted successfully.').optional(),
}).describe('The monitor deletion acknowledgement returned by the UptimeRobot provider.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const uptimerobotActions = {
  get_account_details: {
    description: 'Get account-level monitor usage and profile details from the connected UptimeRobot account.',
    effect: 'read',
    inputSchema: getAccountDetailsInput,
    outputSchema: z.toJSONSchema(getAccountDetailsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_alert_contacts: {
    description: 'List the alert contacts configured in the connected UptimeRobot account.',
    effect: 'read',
    inputSchema: listAlertContactsInput,
    outputSchema: z.toJSONSchema(listAlertContactsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  list_monitors: {
    description: 'List monitors available in the connected UptimeRobot account.',
    effect: 'read',
    inputSchema: listMonitorsInput,
    outputSchema: z.toJSONSchema(listMonitorsOutput, { io: 'output', unrepresentable: 'any' }),
  },
  get_monitor: {
    description: 'Get the full configuration and current status of a single UptimeRobot monitor.',
    effect: 'read',
    inputSchema: getMonitorInput,
    outputSchema: z.toJSONSchema(getMonitorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  create_monitor: {
    description: 'Create a new monitor in the connected UptimeRobot account.',
    effect: 'write',
    inputSchema: createMonitorInput,
    outputSchema: z.toJSONSchema(createMonitorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  update_monitor: {
    description: 'Update an existing monitor in the connected UptimeRobot account.',
    effect: 'write',
    inputSchema: updateMonitorInput,
    outputSchema: z.toJSONSchema(updateMonitorOutput, { io: 'output', unrepresentable: 'any' }),
  },
  delete_monitor: {
    description: 'Delete a monitor from the connected UptimeRobot account.',
    effect: 'destructive',
    inputSchema: deleteMonitorInput,
    outputSchema: z.toJSONSchema(deleteMonitorOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
