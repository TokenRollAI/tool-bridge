// Resolve URL path segments to a node and serve its help or invoke its endpoint.

import { adapterFor } from './adapters';
import { buildTextHelp } from './help';
import { findNode, nodePath } from './registry';
import { AdapterContext, AppEnv, AuthMode, DirectoryNode, HelpPayload } from './types';
import { json, text } from './util';

export interface ResolvedHelp {
  payload: HelpPayload;
  resourcePath: string;
}

// `root` is the tree to resolve against — the tenant's tree (multi-tenant) or
// the global env tree (fallback). Resolving against a single per-request root is
// the tenant isolation boundary: findNode only descends root.children.
async function describe(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode
): Promise<ResolvedHelp> {
  const found = findNode(root, segments);
  if (!found) {
    throw new NotFoundError(`No TB resource at '/${segments.join('/')}'.`);
  }
  const resourcePath = nodePath(found.node);
  const ctx: AdapterContext = { env, authMode, basePath: resourcePath };
  const payload = await adapterFor(found.node).describe(found.node, ctx, found.sub);
  return { payload, resourcePath };
}

// GET {path}/~help with content negotiation: JSON by default, text DSL on
// `Accept: text/plain`.
export async function resolveHelp(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode,
  accept: string
): Promise<Response> {
  const { payload, resourcePath } = await describe(env, root, segments, authMode);

  if (prefersText(accept)) {
    const auth = authMode === 'none' ? 'none' : 'bearer';
    return text(buildTextHelp(payload, resourcePath, auth), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': cacheControl(payload, authMode) },
    });
  }
  return json(payload, { headers: { 'Cache-Control': cacheControl(payload, authMode) } });
}

// POST {path} — invoke an end-path resource.
export async function resolveCall(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode,
  input: unknown
): Promise<Response> {
  const found = findNode(root, segments);
  if (!found) {
    throw new NotFoundError(`No TB resource at '/${segments.join('/')}'.`);
  }
  const resourcePath = nodePath(found.node);
  const ctx: AdapterContext = { env, authMode, basePath: resourcePath };
  const result = await adapterFor(found.node).call(found.node, ctx, found.sub, input);
  return json({ resource: resourcePath, result });
}

export class NotFoundError extends Error {}

// GET {path}/~skill — a Markdown operational guide for the resource, derived
// from its help payload. Works for every node kind (directory / mcp / http /
// mount / remote) without per-adapter code.
export async function resolveSkill(
  env: AppEnv,
  root: DirectoryNode,
  segments: string[],
  authMode: AuthMode
): Promise<Response> {
  const { payload, resourcePath } = await describe(env, root, segments, authMode);
  return text(buildSkillMarkdown(payload, resourcePath, authMode), {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

function buildSkillMarkdown(payload: HelpPayload, resourcePath: string, authMode: AuthMode): string {
  const lines: string[] = [`# ${payload.title}`, ''];
  if (payload.description) {
    lines.push(payload.description, '');
  }

  lines.push('## When To Use', '');
  lines.push(
    payload.endpoint
      ? `这是一个 end-path 资源,直接调用它来完成任务。`
      : `这是一个目录节点,先读取它的 \`~help\` 列表,选择下一层资源继续下钻。`,
    ''
  );

  if (authMode !== 'none') {
    lines.push('## Authentication', '', '所有请求需带 `Authorization: Bearer <token>`。', '');
  }

  if (payload.resources && payload.resources.length > 0) {
    lines.push('## Next Layer', '');
    for (const ref of payload.resources) {
      lines.push(`- \`${ref.path}\`${ref.description ? ` — ${ref.description}` : ''}`);
    }
    lines.push('');
  }

  if (payload.endpoint) {
    lines.push('## Request Construction', '');
    lines.push('```http', `${payload.endpoint.method} ${resourcePath}`, 'Content-Type: application/json', '```', '');
    if (payload.endpoint.tools && payload.endpoint.tools.length > 0) {
      lines.push('请求体用 `tool` 选择具体工具,`arguments` 传该工具参数:', '');
      lines.push('```json', JSON.stringify(payload.endpoint.example ?? { tool: '', arguments: {} }, null, 2), '```', '');
      lines.push('### Available Tools', '');
      for (const tool of payload.endpoint.tools) {
        lines.push(`- \`${tool.name}\`${tool.description ? ` — ${tool.description}` : ''}`);
      }
      lines.push('');
    } else if (payload.endpoint.example !== undefined) {
      lines.push('示例请求体:', '', '```json', JSON.stringify(payload.endpoint.example, null, 2), '```', '');
    }
  }

  lines.push('## Safety', '', '调用会转发到上游资源;执行有副作用的操作前请先确认意图。', '');
  return `${lines.join('\n').trimEnd()}\n`;
}

function prefersText(accept: string): boolean {
  const value = accept.toLowerCase();
  if (value.includes('application/json')) {
    return false;
  }
  return value.includes('text/plain') || value.includes('text/markdown');
}

function cacheControl(payload: HelpPayload, authMode: AuthMode): string {
  const scope = authMode === 'none' ? 'public' : 'private';
  return payload.cachable === false ? 'no-store' : `${scope}, max-age=300`;
}
