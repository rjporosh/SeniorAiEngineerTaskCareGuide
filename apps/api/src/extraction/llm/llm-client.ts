import { ExtractionUnavailableError } from '../types.js';

export interface LlmRequest { system: string; user: string; schema: Record<string, unknown>; signal: AbortSignal }

/** Minimal chat-completion port: returns the raw JSON text the model produced. Adapters never log prompts or document text. */
export interface LlmClient {
  readonly provider: 'ollama' | 'openai';
  readonly model: string;
  completeJson(req: LlmRequest): Promise<string>;
}

type Fetch = typeof fetch;

async function post(fetchImpl: Fetch, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal, what: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    throw new ExtractionUnavailableError(`${what} is unreachable (${(e as Error).name === 'TimeoutError' || (e as Error).name === 'AbortError' ? 'timed out' : 'connection failed'})`, { cause: e });
  }
  if (!res.ok) throw new ExtractionUnavailableError(`${what} returned HTTP ${res.status}`);
  try { return await res.json(); } catch (e) { throw new ExtractionUnavailableError(`${what} returned a non-JSON response`, { cause: e }); }
}

export class OllamaClient implements LlmClient {
  readonly provider = 'ollama' as const;
  constructor(private readonly baseUrl: string, readonly model: string, private readonly numCtx: number, private readonly fetchImpl: Fetch = fetch) {}

  async completeJson(req: LlmRequest): Promise<string> {
    const json = await post(this.fetchImpl, `${this.baseUrl}/api/chat`, {}, {
      model: this.model, stream: false, format: req.schema,
      options: { temperature: 0, num_ctx: this.numCtx },
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    }, req.signal, 'Ollama') as { message?: { content?: unknown }; error?: unknown };
    if (typeof json.message?.content !== 'string') throw new ExtractionUnavailableError(`Ollama returned no message${typeof json.error === 'string' ? `: ${json.error}` : ''}`);
    return json.message.content;
  }
}

export class OpenAiClient implements LlmClient {
  readonly provider = 'openai' as const;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, readonly model: string, private readonly fetchImpl: Fetch = fetch) {}

  async completeJson(req: LlmRequest): Promise<string> {
    const json = await post(this.fetchImpl, `${this.baseUrl}/chat/completions`, { authorization: `Bearer ${this.apiKey}` }, {
      model: this.model, temperature: 0,
      response_format: { type: 'json_schema', json_schema: { name: 'invoice_extraction', strict: true, schema: req.schema } },
      messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }],
    }, req.signal, 'OpenAI') as { choices?: { message?: { content?: unknown } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new ExtractionUnavailableError('OpenAI returned no message content');
    return content;
  }
}
