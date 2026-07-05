// Text/plain HTBP DSL rendering of a JSON HelpPayload.
//
// JSON is the primary help form. This renders the same payload as the
// line-oriented HTBP DSL (RFC-0001 §8.3/8.4) for `Accept: text/plain` content
// negotiation and backward compatibility with text-only agents.

import { EndpointSpec, HelpPayload, ToolSpec } from './types';
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
    const { method, tools } = payload.endpoint;
    if (tools && tools.length > 0) {
      // MCP / builtin whole-leaf: one cmd per tool, all POSTing to this same
      // resource with a body that selects the tool by name.
      for (const tool of tools) {
        lines.push(`cmd ${tool.name} ${method} ${resourcePath}`);
        lines.push(`  body application/json {"tool":"${tool.name}","arguments":object?}`);
        lines.push(`  auth ${auth}`);
        appendSemantics(lines, tool);
        lines.push('  returns 200 application/json');
        if (tool.description) {
          lines.push(`  note ${oneLine(tool.description)}`);
        }
      }
    } else {
      // Single-shot end-path (e.g. an HTTP endpoint).
      lines.push(`cmd call ${method} ${resourcePath}`);
      lines.push('  body application/json {"arguments":object?}');
      lines.push(`  auth ${auth}`);
      appendSemantics(lines, payload.endpoint);
      lines.push('  returns 200 application/json');
    }
  }

  for (const resource of payload.resources ?? []) {
    lines.push(`link child ${joinRelative(resourcePath, resource.path)}/~help`);
    if (resource.description) {
      lines.push(`  note ${oneLine(resource.description)}`);
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

// Emit the call-semantics lines for a tool or single-shot endpoint. `effect`
// falls back to `external` (the historical default), so pre-existing callers
// that declare nothing render byte-for-byte the same `effect external` line.
// `scope` / `confirm` lines appear only when declared.
function appendSemantics(lines: string[], spec: Pick<ToolSpec, 'effect' | 'scope' | 'confirm'> | EndpointSpec): void {
  lines.push(`  effect ${spec.effect ?? 'external'}`);
  if (spec.scope) {
    lines.push(`  scope ${oneLine(spec.scope)}`);
  }
  if (spec.confirm) {
    lines.push('  confirm true');
  }
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
