/**
 * IPQualityScore 各 action 的入参/出参 Zod schema 与语义标注。
 *
 * **由 `scripts/migrate` 从 open-connector 的 action 定义生成**,生成后归本仓库所有:
 * 可以直接改(收紧 schema、改 description、修 effect)。改过的 action 请登记进同目录的
 * `handwritten.json`,否则重新生成会覆盖你的修改,等价闸门也会拿上游 schema 判它。
 *
 * `effect` 上游没有这个轴,生成时按 action 名前缀**播种**(读前缀 read、删除前缀
 * destructive、其余 write),保守取值,以人工校正为准。
 */

import { z } from 'zod/v4'

export const checkIpReputationInput = z.strictObject({
  ipAddress: z.string().min(1).describe('The IPv4 or IPv6 address to inspect.'),
  strictness: z.int().min(0).max(3).describe('How strict IPQS should be when scoring the lookup. Higher values may increase false positives.').optional(),
  allowPublicAccessPoints: z.boolean().describe('Whether to reduce risk flags for public access points such as schools or libraries.').optional(),
  userAgent: z.string().min(1).describe('The user agent associated with the IP lookup.').optional(),
  userLanguage: z.string().min(1).describe('The browser language associated with the IP lookup.').optional(),
}).describe('Input for checking IP address reputation with IPQualityScore.')

export const checkIpReputationOutput = z.looseObject({
  success: z.boolean().describe('Whether IPQS completed the IP reputation lookup successfully.'),
  message: z.string().describe('Human-readable status message returned by IPQS.'),
  fraud_score: z.int().min(0).max(100).describe('The risk score returned by IPQS from 0 to 100.'),
  country_code: z.string().describe('The two-letter country code associated with the IP.').nullable().optional(),
  region: z.string().describe('The region associated with the IP.').nullable().optional(),
  city: z.string().describe('The city associated with the IP.').nullable().optional(),
  ISP: z.string().describe('The internet service provider associated with the IP.').nullable().optional(),
  ASN: z.int().describe('The autonomous system number associated with the IP.').nullable().optional(),
  organization: z.string().describe('The organization associated with the IP.').nullable().optional(),
  is_crawler: z.boolean().describe('Whether IPQS identified the IP as a crawler.').optional(),
  timezone: z.string().describe('The timezone associated with the IP.').nullable().optional(),
  mobile: z.boolean().describe('Whether the IP appears to belong to a mobile connection.').optional(),
  host: z.string().describe('The host associated with the IP.').nullable().optional(),
  proxy: z.boolean().describe('Whether IPQS identified the IP as a proxy.').optional(),
  vpn: z.boolean().describe('Whether IPQS identified the IP as a VPN.').optional(),
  tor: z.boolean().describe('Whether IPQS identified the IP as Tor.').optional(),
  active_vpn: z.boolean().describe('Whether IPQS identified an active VPN connection.').optional(),
  active_tor: z.boolean().describe('Whether IPQS identified an active Tor connection.').optional(),
  recent_abuse: z.boolean().describe('Whether IPQS has seen recent abuse from the IP.').optional(),
  bot_status: z.boolean().describe('Whether IPQS identified bot behavior for the IP.').optional(),
  connection_type: z.string().describe('The connection type associated with the IP.').nullable().optional(),
  abuse_velocity: z.string().describe('The recent abuse velocity associated with the IP.').nullable().optional(),
  request_id: z.string().describe('The IPQS request identifier for support and tracing.').optional(),
}).describe('IP reputation result returned by IPQualityScore.')

export const validateEmailInput = z.strictObject({
  email: z.email().describe('The email address to validate.'),
  timeout: z.int().min(1).max(60).describe('Maximum number of seconds IPQS should spend on mail service provider checks.').optional(),
  abuseStrictness: z.int().min(0).max(3).describe('How strict IPQS should be when scoring the lookup. Higher values may increase false positives.').optional(),
}).describe('Input for validating an email address with IPQualityScore.')

export const validateEmailOutput = z.looseObject({
  success: z.boolean().describe('Whether IPQS completed the email validation lookup successfully.'),
  message: z.string().describe('Human-readable status message returned by IPQS.'),
  valid: z.boolean().describe('Whether IPQS considers the email address valid.'),
  disposable: z.boolean().describe('Whether the email address belongs to a disposable email provider.').optional(),
  smtp_score: z.int().describe('The SMTP deliverability score returned by IPQS.').nullable().optional(),
  overall_score: z.int().describe('The overall email quality score returned by IPQS.').nullable().optional(),
  first_name: z.string().describe('The first name inferred by IPQS, when available.').nullable().optional(),
  generic: z.boolean().describe('Whether IPQS considers the email address generic.').optional(),
  common: z.boolean().describe('Whether the email address is commonly used.').optional(),
  dns_valid: z.boolean().describe('Whether DNS records for the email domain are valid.').optional(),
  honeypot: z.boolean().describe('Whether IPQS identified the email as a honeypot.').optional(),
  deliverability: z.string().describe('The deliverability classification returned by IPQS.').nullable().optional(),
  frequent_complainer: z.boolean().describe('Whether the email is associated with frequent complaints.').optional(),
  spam_trap_score: z.string().describe('The spam trap score returned by IPQS.').nullable().optional(),
  catch_all: z.boolean().describe('Whether the email domain accepts all mailbox names.').optional(),
  timed_out: z.boolean().describe('Whether IPQS timed out during provider checks.').optional(),
  suspect: z.boolean().describe('Whether IPQS considers the email suspicious.').optional(),
  recent_abuse: z.boolean().describe('Whether IPQS has seen recent abuse for the email.').optional(),
  fraud_score: z.int().min(0).max(100).describe('The risk score returned by IPQS from 0 to 100.').optional(),
  suggested_domain: z.string().describe('Suggested corrected domain for possible typos.').nullable().optional(),
  leaked: z.boolean().describe('Whether IPQS found the email in leaked data.').optional(),
  sanitized_email: z.email().describe('The normalized email address returned by IPQS.').optional(),
  request_id: z.string().describe('The IPQS request identifier for support and tracing.').optional(),
}).describe('Email validation result returned by IPQualityScore.')

export const validatePhoneInput = z.strictObject({
  phone: z.string().min(1).describe('The phone number to validate.'),
  country: z.array(z.string().min(2).max(2).regex(new RegExp('^[A-Za-z]{2}$')).describe('An ISO 3166-1 alpha-2 country code.')).min(1).describe('Optional ISO 3166-1 alpha-2 countries to use when interpreting local numbers.').optional(),
  strictness: z.int().min(0).max(3).describe('How strict IPQS should be when scoring the lookup. Higher values may increase false positives.').optional(),
}).describe('Input for validating a phone number with IPQualityScore.')

export const validatePhoneOutput = z.looseObject({
  success: z.boolean().describe('Whether IPQS completed the phone validation lookup successfully.'),
  message: z.string().describe('Human-readable status message returned by IPQS.'),
  formatted: z.string().describe('The formatted phone number returned by IPQS.').nullable().optional(),
  local_format: z.string().describe('The local phone number format returned by IPQS.').nullable().optional(),
  valid: z.boolean().describe('Whether IPQS considers the phone number valid.'),
  fraud_score: z.int().min(0).max(100).describe('The risk score returned by IPQS from 0 to 100.').optional(),
  recent_abuse: z.boolean().describe('Whether IPQS has seen recent abuse for the phone number.').optional(),
  VOIP: z.boolean().describe('Whether the phone number appears to be a VoIP number.').optional(),
  prepaid: z.boolean().describe('Whether the phone number appears to be prepaid.').optional(),
  risky: z.boolean().describe('Whether IPQS considers the phone number risky.').optional(),
  active: z.boolean().describe('Whether IPQS considers the phone number active.').optional(),
  name: z.string().describe('The phone owner name returned by IPQS, when available.').nullable().optional(),
  carrier: z.string().describe('The carrier associated with the phone number.').nullable().optional(),
  line_type: z.string().describe('The line type associated with the phone number.').nullable().optional(),
  country: z.string().describe('The country associated with the phone number.').nullable().optional(),
  city: z.string().describe('The city associated with the phone number.').nullable().optional(),
  zip_code: z.string().describe('The postal code associated with the phone number.').nullable().optional(),
  region: z.string().describe('The region associated with the phone number.').nullable().optional(),
  dialing_code: z.int().describe('The international dialing code associated with the phone number.').nullable().optional(),
  sms_pumping: z.looseObject({
    risk_score: z.int().min(0).max(100).describe('The risk score returned by IPQS from 0 to 100.').optional(),
    message: z.string().describe('Human-readable SMS pumping risk message returned by IPQS.').optional(),
    velocity: z.string().describe('SMS pumping velocity classification returned by IPQS.').optional(),
  }).describe('SMS pumping risk details returned by IPQS.').optional(),
  request_id: z.string().describe('The IPQS request identifier for support and tracing.').optional(),
}).describe('Phone validation result returned by IPQualityScore.')

export const scanUrlInput = z.strictObject({
  url: z.string().min(1).describe('The URL or domain to scan.'),
  strictness: z.int().min(0).max(2).describe('How strict IPQS should be when scanning the URL. Higher values may increase false positives.').optional(),
}).describe('Input for scanning a URL or domain with IPQualityScore.')

export const scanUrlOutput = z.looseObject({
  success: z.boolean().describe('Whether IPQS completed the URL scan successfully.'),
  message: z.string().describe('Human-readable status message returned by IPQS.'),
  unsafe: z.boolean().describe('Whether IPQS considers the URL unsafe.'),
  domain: z.string().describe('The domain parsed from the submitted URL.').nullable().optional(),
  root_domain: z.string().describe('The root domain parsed from the submitted URL.').nullable().optional(),
  ip_address: z.string().describe('The IP address associated with the domain.').nullable().optional(),
  server: z.string().describe('The server header or hosting stack returned by IPQS.').nullable().optional(),
  content_type: z.string().describe('The content type returned by IPQS.').nullable().optional(),
  status_code: z.int().describe('The HTTP status code returned by IPQS.').nullable().optional(),
  page_size: z.int().describe('The page size returned by IPQS.').nullable().optional(),
  domain_rank: z.int().describe('The domain rank returned by IPQS.').nullable().optional(),
  dns_valid: z.boolean().describe('Whether DNS records for the domain are valid.').optional(),
  parking: z.boolean().describe('Whether IPQS considers the domain parked.').optional(),
  spamming: z.boolean().describe('Whether IPQS associates the URL with spam.').optional(),
  malware: z.boolean().describe('Whether IPQS associates the URL with malware.').optional(),
  phishing: z.boolean().describe('Whether IPQS associates the URL with phishing.').optional(),
  suspicious: z.boolean().describe('Whether IPQS considers the URL suspicious.').optional(),
  adult: z.boolean().describe('Whether IPQS classifies the URL as adult content.').optional(),
  risk_score: z.int().min(0).max(100).describe('The risk score returned by IPQS from 0 to 100.').optional(),
  domain_age: z.looseObject({
    human: z.string().describe('Human-readable domain age returned by IPQS.').nullable().optional(),
    timestamp: z.int().describe('Domain creation timestamp returned by IPQS.').nullable().optional(),
    iso: z.string().describe('Domain creation date returned by IPQS.').nullable().optional(),
  }).describe('Domain age details returned by IPQualityScore.').optional(),
  category: z.string().describe('The content category returned by IPQS.').nullable().optional(),
  domain_trust: z.string().describe('The domain trust classification returned by IPQS.').nullable().optional(),
  request_id: z.string().describe('The IPQS request identifier for support and tracing.').optional(),
}).describe('URL reputation result returned by IPQualityScore.')

/** action 名 → 注册用的 OperationSpec(description / effect / schema)。 */
export const ipqualityscoreActions = {
  check_ip_reputation: {
    description: 'Check an IP address for proxy, VPN, Tor, bot, and abuse risk signals.',
    effect: 'read',
    inputSchema: checkIpReputationInput,
    outputSchema: z.toJSONSchema(checkIpReputationOutput, { io: 'output', unrepresentable: 'any' }),
  },
  validate_email: {
    description: 'Validate an email address and return deliverability and abuse risk signals.',
    effect: 'write',
    inputSchema: validateEmailInput,
    outputSchema: z.toJSONSchema(validateEmailOutput, { io: 'output', unrepresentable: 'any' }),
  },
  validate_phone: {
    description: 'Validate a phone number and return carrier, activity, and risk signals.',
    effect: 'write',
    inputSchema: validatePhoneInput,
    outputSchema: z.toJSONSchema(validatePhoneOutput, { io: 'output', unrepresentable: 'any' }),
  },
  scan_url: {
    description: 'Scan a URL or domain and return malware, phishing, and domain risk signals.',
    effect: 'write',
    inputSchema: scanUrlInput,
    outputSchema: z.toJSONSchema(scanUrlOutput, { io: 'output', unrepresentable: 'any' }),
  },
} as const
