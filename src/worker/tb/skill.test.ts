import { describe, expect, it } from 'vitest';
import { parseTree } from './registry';
import { resolveSkill } from './resolve';
import { AppEnv } from './types';

function envWith(json: unknown): AppEnv {
  return { MCP_SERVERS_JSON: JSON.stringify(json) } as unknown as AppEnv;
}

describe('resolveSkill', () => {
  it('renders a Markdown skill for a directory node listing its next layer', async () => {
    const env = envWith({
      type: 'directory',
      id: 'root',
      title: 'Catalog',
      children: [
        { type: 'http', id: 'weather', title: 'Weather', endpoints: [{ name: 'now', method: 'GET', url: 'https://x/n' }] },
      ],
    });
    const res = await resolveSkill(env, parseTree(env), [], 'none');
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const md = await res.text();
    expect(md).toContain('# Catalog');
    expect(md).toContain('## Next Layer');
    expect(md).toContain('./weather');
  });

  it('renders request construction + tools for an http end-path leaf', async () => {
    const env = envWith({
      type: 'directory',
      id: 'root',
      children: [
        { type: 'http', id: 'weather', title: 'Weather', endpoints: [{ name: 'now', method: 'GET', url: 'https://x/n' }] },
      ],
    });
    // /weather/now is the end-path
    const res = await resolveSkill(env, parseTree(env), ['weather', 'now'], 'none');
    const md = await res.text();
    expect(md).toContain('## Request Construction');
    expect(md).toContain('GET /htbp/weather');
  });
});
