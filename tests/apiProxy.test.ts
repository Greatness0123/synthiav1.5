import geminiHandler from '../api/infer/gemini';
import openaiCompatHandler from '../api/infer/openai-compat';

describe('Serverless AI Proxy Layer Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    // Set up default env secrets for tests
    process.env.SYNTHIA_SHARED_SECRET = 'super-secret-token';
    process.env.GEMINI_API_KEY = 'gemini-key-123';
    process.env.GROQ_API_KEY = 'groq-key-123';
    process.env.OPENAI_API_KEY = 'openai-key-123';

    // Mock global fetch
    globalThis.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  describe('Authorization Checks', () => {
    it('should return 401 if Authorization header is missing', async () => {
      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: { contents: [] } }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('should return 401 if Authorization header has wrong token', async () => {
      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer wrong-token',
        },
        body: JSON.stringify({ payload: { contents: [] } }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('should return 500 if SYNTHIA_SHARED_SECRET is not configured on server', async () => {
      delete process.env.SYNTHIA_SHARED_SECRET;

      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({ payload: { contents: [] } }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('SYNTHIA_SHARED_SECRET is not configured');
    });
  });

  describe('Gemini Proxy Handler', () => {
    it('should return 400 if payload is missing', async () => {
      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({ model: 'gemini-2.0-flash' }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing payload parameter');
    });

    it('should return 500 if GEMINI_API_KEY is missing on server', async () => {
      delete process.env.GEMINI_API_KEY;

      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({ payload: { contents: [] } }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('GEMINI_API_KEY is not configured');
    });

    it('should correctly proxy successful Gemini request and stream response', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('chunk1'));
          controller.enqueue(new TextEncoder().encode('chunk2'));
          controller.close();
        }
      });

      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        body: mockStream,
      });

      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({
          model: 'gemini-2.0-flash-test',
          payload: { contents: [{ parts: [{ text: 'Hello' }] }] },
        }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      // Verify that fetch was called with the injected API key
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-test:streamGenerateContent?alt=sse&key=gemini-key-123',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ contents: [{ parts: [{ text: 'Hello' }] }] }),
        })
      );

      // Verify stream reading
      const reader = response.body?.getReader();
      const chunk1 = await reader?.read();
      const chunk2 = await reader?.read();
      const done = await reader?.read();

      expect(new TextDecoder().decode(chunk1?.value)).toBe('chunk1');
      expect(new TextDecoder().decode(chunk2?.value)).toBe('chunk2');
      expect(done?.done).toBe(true);
    });

    it('should handle and pass through Gemini API errors', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Invalid model or payload request',
      });

      const request = new Request('http://localhost/api/infer/gemini', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({
          payload: { contents: [] },
        }),
      });

      const response = await geminiHandler(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Gemini API error (400): Invalid model or payload request');
    });
  });

  describe('OpenAI-compatible Proxy Handler', () => {
    it('should return 400 if provider is missing', async () => {
      const request = new Request('http://localhost/api/infer/openai-compat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({ payload: { messages: [] } }),
      });

      const response = await openaiCompatHandler(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Missing provider parameter');
    });

    it('should return 400 for unsupported or disallowed provider', async () => {
      const request = new Request('http://localhost/api/infer/openai-compat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({ provider: 'unsupported-llm', payload: { messages: [] } }),
      });

      const response = await openaiCompatHandler(request);
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain('Unsupported or disallowed provider');
    });

    it('should return 500 if provider API key is missing on server', async () => {
      delete process.env.GROQ_API_KEY;

      const request = new Request('http://localhost/api/infer/openai-compat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({ provider: 'groq', payload: { messages: [] } }),
      });

      const response = await openaiCompatHandler(request);
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain('GROQ_API_KEY is not configured');
    });

    it('should correctly proxy successful Groq request and stream response', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
          controller.close();
        }
      });

      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        body: mockStream,
      });

      const request = new Request('http://localhost/api/infer/openai-compat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({
          provider: 'groq',
          payload: { messages: [{ role: 'user', content: 'Hi' }] },
        }),
      });

      const response = await openaiCompatHandler(request);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('text/event-stream');

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.groq.com/openai/v1/chat/completions',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Authorization': 'Bearer groq-key-123',
          }),
          body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] }),
        })
      );

      const reader = response.body?.getReader();
      const chunk = await reader?.read();
      expect(new TextDecoder().decode(chunk?.value)).toContain('choices');
    });

    it('should inject Referer and Title headers for OpenRouter requests', async () => {
      (globalThis.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'Content-Type': 'text/event-stream' }),
        body: new ReadableStream({ start: (c) => c.close() }),
      });

      const request = new Request('http://localhost/api/infer/openai-compat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer super-secret-token',
        },
        body: JSON.stringify({
          provider: 'openrouter',
          payload: { messages: [] },
        }),
      });

      process.env.OPENROUTER_API_KEY = 'openrouter-key-123';

      await openaiCompatHandler(request);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://openrouter.ai/api/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer openrouter-key-123',
            'HTTP-Referer': 'https://synthia.ai',
            'X-Title': 'Synthia',
          }),
        })
      );
    });
  });
});
