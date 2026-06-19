import { getAssetFromKV } from '@cloudflare/kv-asset-handler';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname === '/state' && request.method === 'GET') {
      const data = await env.CHECKLIST_KV.get('state');
      return new Response(data || '{}', {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    if (url.pathname === '/state' && request.method === 'POST') {
      const body = await request.json();
      await env.CHECKLIST_KV.put('state', JSON.stringify(body));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...CORS },
      });
    }

    return new Response('Not found', { status: 404, headers: CORS });
  },
};
