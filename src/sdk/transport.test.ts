import { describe, expect, it } from 'vitest';
import { https } from './transport';

describe('https transport', () => {
  it('normalizes request paths before joining them to the base URL', async () => {
    const urls: string[] = [];
    const transport = https('https://bridge.example.com/', async (input) => {
      urls.push(String(input));
      return new Response('{}');
    });

    await transport.fetch('api/providers');
    await transport.fetch('/api/placements');

    expect(urls).toEqual(['https://bridge.example.com/api/providers', 'https://bridge.example.com/api/placements']);
  });
});
