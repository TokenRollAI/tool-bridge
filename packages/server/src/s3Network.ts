import { isIP, type LookupFunction } from 'node:net'
import { Agent as HttpsAgent } from 'node:https'
import { lookup as dnsLookup } from 'node:dns'
import { Agent as HttpAgent } from 'node:http'
import { TBError } from '@tool-bridge/core'
import ipaddr from 'ipaddr.js'

export interface S3NetworkOptions {
  /** Deployment-owned exact origin. Never derive this exception from a user endpoint. */
  internalOrigin?: string
}

function originUrl(value: string): URL {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TBError(
      'invalid_argument',
      'S3 endpoint must be an absolute HTTP(S) origin',
    )
  }
  if (
    !['https:', 'http:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
    || url.pathname !== '/'
  ) {
    throw new TBError(
      'invalid_argument',
      'S3 endpoint must be an HTTP(S) origin without credentials, path, query or fragment',
    )
  }
  return url
}

export function assertS3Address(address: string, internal: boolean): void {
  let range: string
  try {
    range = ipaddr.process(address).range()
  } catch {
    throw new TBError('permission_denied', 'S3 address is invalid')
  }
  if (range === 'unicast') return
  // Even a configured internal service must never target metadata/link-local,
  // multicast, unspecified or reserved addresses.
  if (internal && ['private', 'loopback', 'uniqueLocal'].includes(range)) return
  throw new TBError(
    'permission_denied',
    'S3 network policy rejected the destination address',
  )
}

export function s3Network(endpoint: string, options: S3NetworkOptions = {}) {
  const url = originUrl(endpoint)
  const internal
    = options.internalOrigin !== undefined
      && originUrl(options.internalOrigin).origin === url.origin
  if (url.protocol !== 'https:' && !internal) {
    throw new TBError(
      'permission_denied',
      'S3 requires HTTPS outside the configured internal origin',
    )
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (isIP(hostname)) assertS3Address(hostname, internal)
  const lookup: LookupFunction = (name, opts, callback) => {
    if (name !== hostname) {
      callback(
        new Error('S3 network policy rejected the destination host'),
        '',
        4,
      )
      return
    }
    // This callback supplies the actual socket address. There is no second DNS
    // lookup between validation and connect; every new connection is checked.
    dnsLookup(name, { all: true, verbatim: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 4)
        return
      }
      try {
        if (addresses.length === 0)
          throw new Error('S3 DNS returned no address')
        for (const result of addresses)
          assertS3Address(result.address, internal)
        const family = typeof opts === 'number' ? opts : opts.family
        const selected = addresses.filter(
          result => !family || result.family === family,
        )
        if (selected.length === 0)
          throw new Error('S3 DNS returned no matching address family')
        if (typeof opts === 'object' && opts.all) callback(null, selected)
        else callback(null, selected[0]!.address, selected[0]!.family)
      } catch {
        callback(
          new Error('S3 network policy rejected the resolved address'),
          '',
          4,
        )
      }
    })
  }
  return {
    endpoint: url.origin,
    httpAgent: new HttpAgent({ keepAlive: true, maxSockets: 32, lookup }),
    httpsAgent: new HttpsAgent({ keepAlive: true, maxSockets: 32, lookup }),
  }
}
