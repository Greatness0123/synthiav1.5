export const config = {
  runtime: 'edge',
};

const PROVIDER_MAP: Record<string, { baseUrl: string; envKeyName: string }> = {
  groq: { baseUrl: 'https://api.groq.com/openai/v1', envKeyName: 'GROQ_API_KEY' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', envKeyName: 'OPENROUTER_API_KEY' },
  nim: { baseUrl: 'https://integrate.api.nvidia.com/v1', envKeyName: 'NIM_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', envKeyName: 'OPENAI_API_KEY' },
};

export default async function handler(request: Request): Promise<Response> {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Auth check
  const sharedSecret = process.env.SYNTHIA_SHARED_SECRET;
  if (!sharedSecret) {
    return new Response(JSON.stringify({ error: 'SYNTHIA_SHARED_SECRET is not configured on the server.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const authHeader = request.headers.get('Authorization');
  if (!authHeader || authHeader !== `Bearer ${sharedSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized: Invalid or missing token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Parse body
  let body: any;
  try {
    body = await request.json();
  } catch (err: any) {
    return new Response(JSON.stringify({ error: `Invalid JSON body: ${err.message}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const { provider, payload } = body;
  if (!provider) {
    return new Response(JSON.stringify({ error: 'Missing provider parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!payload) {
    return new Response(JSON.stringify({ error: 'Missing payload parameter' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const lowerProvider = provider.toLowerCase();
  const providerConfig = PROVIDER_MAP[lowerProvider];
  if (!providerConfig) {
    return new Response(JSON.stringify({ error: `Unsupported or disallowed provider: ${provider}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = process.env[providerConfig.envKeyName];
  if (!apiKey) {
    return new Response(JSON.stringify({ error: `${providerConfig.envKeyName} is not configured on the server.` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const url = `${providerConfig.baseUrl}/chat/completions`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  if (lowerProvider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://synthia.ai';
    headers['X-Title'] = 'Synthia';
  }

  try {
    const providerRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!providerRes.ok) {
      const errorText = await providerRes.text();
      return new Response(JSON.stringify({ error: `${provider} API error (${providerRes.status}): ${errorText}` }), {
        status: providerRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(providerRes.body, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': providerRes.headers.get('Content-Type') || 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: `Internal Server Error: ${error.message}` }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}
