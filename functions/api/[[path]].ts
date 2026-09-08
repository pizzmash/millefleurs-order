import type { PagesFunction, Fetcher } from '@cloudflare/workers-types';
export const onRequest: PagesFunction<{ API: Fetcher }> = async ({ request, env }) => {
  const response = await env.API.fetch(request);
  return response;
};
