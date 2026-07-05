// SDK transport abstraction (SPEC-001 §8.3): the same client code runs over a
// Cloudflare service binding (same-account Worker-to-Worker fetch) or plain
// HTTPS. The transport carries requests; it is NOT a credential — callers
// always attach their own Authorization header (v0.2 T-11 "trusted bare
// channel" is dead: a channel is not a credential).

export interface Transport {
  fetch(path: string, init?: RequestInit): Promise<Response>;
}

// Minimal shape of a Cloudflare service binding (env.SOMETHING with .fetch).
export interface FetcherLike {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}

// HTTPS transport: resolve paths against a base URL using the runtime fetch.
export function https(baseUrl: string, fetchImpl?: FetcherLike['fetch']): Transport {
  const base = baseUrl.replace(/\/+$/, '');
  const doFetch = fetchImpl ?? ((input: Request | string, init?: RequestInit) => fetch(input as string, init));
  return {
    fetch(path: string, init?: RequestInit): Promise<Response> {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      return doFetch(`${base}${normalizedPath}`, init);
    },
  };
}

// Service-binding transport: route through the bound Fetcher. The URL origin
// is synthetic — service bindings dispatch on the bound Worker, not the host.
export function serviceBinding(binding: FetcherLike): Transport {
  return {
    fetch(path: string, init?: RequestInit): Promise<Response> {
      return binding.fetch(new Request(`https://tool-bridge.internal${path}`, init));
    },
  };
}
