import { describe, expect, it } from 'vitest';
import { parseTree } from './registry';
import { resolveHelp } from './resolve';
import { AppEnv } from './types';

function envWith(json: unknown): AppEnv {
  return { MCP_SERVERS_JSON: JSON.stringify(json) } as unknown as AppEnv;
}

// Regression: text-DSL cmd paths must include the adapter sub-path (e.g. the
// http endpoint name), not just the node path. (PR #1 review finding.)
describe('resolveHelp text DSL uses the full resource path', () => {
  const env = envWith({
    type: 'directory',
    id: 'root',
    children: [
      {
        type: 'http',
        id: 'weather',
        title: 'Weather',
        endpoints: [{ name: 'now', method: 'GET', url: 'https://api.example.com/now' }],
      },
    ],
  });

  it('an end-path leaf renders the cmd at its full path', async () => {
    const root = parseTree(env);
    const res = await resolveHelp(env, root, ['weather', 'now'], 'none', 'text/plain');
    const body = await res.text();
    expect(body).toContain('resource /htbp/weather/now');
    expect(body).toContain('GET /htbp/weather/now');
    // must NOT collapse to the node path
    expect(body).not.toContain('cmd call GET /htbp/weather\n');
  });

  it('a directory still renders its own path', async () => {
    const root = parseTree(env);
    const res = await resolveHelp(env, root, [], 'none', 'text/plain');
    const body = await res.text();
    expect(body).toContain('resource /htbp');
  });
});
