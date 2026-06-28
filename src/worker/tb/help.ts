// Text/plain HTBP DSL rendering of a JSON HelpPayload.
//
// JSON is the primary help form. This renders the same payload as the
// line-oriented HTBP DSL (RFC-0001 §8.3/8.4) for `Accept: text/plain` content
// negotiation and backward compatibility with text-only agents.

import { HelpPayload } from './types';
import { oneLine } from './util';

export function buildTextHelp(payload: HelpPayload, resourcePath: string, auth: 'none' | 'bearer'): string {
  const lines: string[] = [
    'htbp draft',
    `resource ${resourcePath}`,
    `title ${oneLine(payload.title)}`,
  ];
  if (payload.description) {
    lines.push(`summary ${oneLine(payload.description)}`);
  }
  lines.push('skill ./~skill', `auth ${auth}`, '');

  if (payload.endpoint) {
    // End-path leaf: emit a single callable command at this resource.
    lines.push(`cmd call ${payload.endpoint.method} ${resourcePath}`);
    lines.push('  body application/json {"arguments":object?}');
    lines.push(`  auth ${auth}`);
    lines.push('  effect external');
    lines.push('  returns 200 application/json');
  }

  for (const resource of payload.resources ?? []) {
    lines.push(`link child ${joinRelative(resourcePath, resource.path)}/~help`);
    if (resource.description) {
      lines.push(`  note ${oneLine(resource.description)}`);
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

// Resolve a relative resource path (e.g. "./context7") against the node's
// absolute resource path for emission in text links.
function joinRelative(base: string, relative: string): string {
  if (relative.startsWith('./')) {
    return `${base}/${relative.slice(2)}`;
  }
  if (relative.startsWith('../')) {
    const parent = base.split('/').slice(0, -1).join('/');
    return `${parent}/${relative.slice(3)}`;
  }
  return `${base}/${relative}`;
}
