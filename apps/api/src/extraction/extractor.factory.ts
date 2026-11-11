import type { AppConfig } from '../config/env.schema.js';
import { LlmInvoiceExtractor } from './llm/llm-extractor.js';
import { OllamaClient, OpenAiClient, type LlmClient } from './llm/llm-client.js';
import { RulesInvoiceExtractor } from './rules-extractor.js';
import type { InvoiceExtractorPort } from './types.js';

type ExtractorConfig = Pick<AppConfig, 'EXTRACTOR_PROVIDER' | 'LLM_TIMEOUT_SECONDS' | 'LLM_MAX_INPUT_CHARS' | 'LLM_FALLBACK_TO_RULES' | 'OLLAMA_BASE_URL' | 'OLLAMA_MODEL' | 'OLLAMA_NUM_CTX' | 'OPENAI_API_KEY' | 'OPENAI_BASE_URL' | 'OPENAI_MODEL'>;

export function createLlmClient(c: ExtractorConfig, fetchImpl: typeof fetch = fetch): LlmClient | null {
  switch (c.EXTRACTOR_PROVIDER) {
    case 'ollama': return new OllamaClient(c.OLLAMA_BASE_URL, c.OLLAMA_MODEL, c.OLLAMA_NUM_CTX, fetchImpl);
    case 'openai': return new OpenAiClient(c.OPENAI_BASE_URL, c.OPENAI_API_KEY!, c.OPENAI_MODEL, fetchImpl);
    default: return null;
  }
}

/** Selects the extractor once at start-up from configuration; use cases only ever see InvoiceExtractorPort. */
export function createExtractor(c: ExtractorConfig, fetchImpl: typeof fetch = fetch): InvoiceExtractorPort {
  const client = createLlmClient(c, fetchImpl);
  if (!client) return new RulesInvoiceExtractor();
  return new LlmInvoiceExtractor(client, { timeoutMs: c.LLM_TIMEOUT_SECONDS * 1000, maxInputChars: c.LLM_MAX_INPUT_CHARS, fallbackToRules: c.LLM_FALLBACK_TO_RULES });
}
