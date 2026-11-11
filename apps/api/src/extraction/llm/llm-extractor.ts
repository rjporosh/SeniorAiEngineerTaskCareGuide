import { z } from 'zod';
import { Decimal } from '../../domain/money.js';
import { normalizeKey } from '../../domain/normalize.js';
import type { Evidence, ExtractorInfo, InvoiceData, InvoiceField, LineItem } from '../../domain/types.js';
import type { ProcessResponse } from '../../processing/processor.types.js';
import { ISO_CURRENCIES, detectCurrency, parseAmount, parseDate, toAsciiDigits } from '../normalizers.js';
import { RulesInvoiceExtractor } from '../rules-extractor.js';
import { ExtractionUnavailableError, type ExtractionNote, type ExtractionResult, type InvoiceExtractorPort } from '../types.js';
import type { LlmClient } from './llm-client.js';
import { OUTPUT_SCHEMA, PROMPT_VERSION, SYSTEM_PROMPT, buildUserPrompt, toSourceLines, type SourceLine } from './prompt.js';

const field = z.strictObject({ value: z.string().max(500).nullable(), evidence: z.string().max(1000).nullable() });
const cell = z.string().max(200).nullable();
/** Strict schema for everything the model returns. Anything outside it is rejected, not repaired. */
export const modelOutputSchema = z.strictObject({
  documentType: z.enum(['invoice', 'credit_note', 'unknown']),
  invoiceNumber: field, invoiceDate: field, supplierName: field, customerName: field,
  subtotal: field, taxAmount: field, totalAmount: field, currency: field,
  lineItems: z.array(z.strictObject({ description: cell, quantity: cell, unitPrice: cell, taxAmount: cell, lineTotal: cell })).max(500),
});
type ModelOutput = z.infer<typeof modelOutputSchema>;

export interface LlmExtractorOptions {
  timeoutMs: number;
  maxInputChars: number;
  /** Use the rules extractor when the model is unreachable or returns unusable output. */
  fallbackToRules: boolean;
}

const SCALARS = ['invoiceNumber', 'invoiceDate', 'supplierName', 'customerName'] as const;
const AMOUNTS = ['subtotal', 'taxAmount', 'totalAmount'] as const;

const fold = (s: string): string => toAsciiDigits(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
/** Two readings agree when one contains the other once punctuation and case are ignored ("ACME LTD" vs "Acme Ltd."). */
const sameText = (a: string, b: string): boolean => {
  const x = normalizeKey(a) ?? ''; const y = normalizeKey(b) ?? '';
  return x === y || (x !== '' && y !== '' && (x.includes(y) || y.includes(x)));
};
const clip = (s: string, n = 200): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Model-backed extractor. The model only proposes values; every value must be found in the source text (grounding),
 * amounts and dates go through the same deterministic normalisers as the rules extractor, and the rules extractor is
 * run alongside as a cross-check and gap filler. Nothing the model says is ever executed.
 */
export class LlmInvoiceExtractor implements InvoiceExtractorPort {
  readonly info: ExtractorInfo;
  private readonly rules = new RulesInvoiceExtractor();

  constructor(private readonly client: LlmClient, private readonly options: LlmExtractorOptions) {
    this.info = { provider: client.provider, version: client.model, promptVersion: PROMPT_VERSION };
  }

  async extract(input: ProcessResponse): Promise<ExtractionResult> {
    const baseline = this.rules.extract(input);
    if (!this.needsModel(input, baseline)) return { ...baseline, extractor: this.rules.info };

    const lines = toSourceLines(input.blocks);
    if (lines.length === 0) return { ...baseline, extractor: this.rules.info };
    try {
      const output = await this.ask(lines);
      return { ...this.merge(output, lines, baseline), extractor: this.info };
    } catch (e) {
      if (!this.options.fallbackToRules) throw e instanceof ExtractionUnavailableError ? e : new ExtractionUnavailableError('The language model produced an unusable response', { cause: e });
      return { ...baseline, extractor: { ...this.rules.info, version: `${this.rules.info.version} (fallback: ${this.client.provider} unavailable)` } };
    }
  }

  /** Clean tabular spreadsheets are exact with the rules; the model is only consulted when they left gaps. */
  private needsModel(input: ProcessResponse, baseline: ExtractionResult): boolean {
    if (baseline.notes.some((n) => n.code === 'MULTIPLE_RECORDS')) return false;
    const spreadsheet = input.file_kind === 'xlsx' || input.file_kind === 'xls' || input.file_kind === 'csv';
    return !spreadsheet || baseline.data.invoiceNumber === null || baseline.data.totalAmount === null;
  }

  private async ask(lines: SourceLine[]): Promise<ModelOutput> {
    const signal = AbortSignal.timeout(this.options.timeoutMs);
    const raw = await this.client.completeJson({ system: SYSTEM_PROMPT, user: buildUserPrompt(lines, this.options.maxInputChars), schema: OUTPUT_SCHEMA as unknown as Record<string, unknown>, signal });
    let json: unknown;
    try { json = JSON.parse(raw); } catch (e) { throw new ExtractionUnavailableError('The language model did not return valid JSON', { cause: e }); }
    const parsed = modelOutputSchema.safeParse(json);
    if (!parsed.success) throw new ExtractionUnavailableError(`The language model output failed schema validation (${parsed.error.issues[0]?.path.join('.') ?? 'root'})`);
    return parsed.data;
  }

  private merge(out: ModelOutput, lines: SourceLine[], baseline: ExtractionResult): Omit<ExtractionResult, 'extractor'> {
    const doc = lines.map((l) => fold(l.text));
    const docText = doc.join('\n');
    const notes: ExtractionNote[] = baseline.notes.filter((n) => !n.field);
    const data: InvoiceData = {
      schemaVersion: '1.0', documentType: out.documentType, invoiceNumber: null, invoiceDate: null, supplierName: null, customerName: null,
      subtotal: null, taxAmount: null, totalAmount: null, currency: null, lineItems: [], fieldEvidence: {}, fieldConfidence: {}, requiresManualReview: true,
    };
    const base = baseline.data;

    /** Locates the line that supports `value`, preferring the model's own quote when it is real and contains the value. */
    const locate = (value: string, quote: string | null): SourceLine | null => {
      const v = fold(value);
      if (!v) return null;
      if (quote) {
        const q = fold(quote);
        let i = doc.findIndex((d) => d.includes(q));
        if (i < 0) i = doc.findIndex((d, idx) => idx + 1 < doc.length && `${d} ${doc[idx + 1]}`.includes(q)); // quote wrapped over two lines
        if (i >= 0 && (doc[i]!.includes(v) || fold(quote).includes(v))) return lines[i]!;
      }
      const i = doc.findIndex((d) => d.includes(v));
      return i >= 0 ? lines[i]! : null;
    };
    const evidenceOf = (l: SourceLine): Evidence => ({ sourcePage: l.page, sourceSheet: l.sheet, sourceCell: l.ref, text: clip(l.text) });
    const put = (f: InvoiceField, value: string, l: SourceLine) => {
      (data as unknown as Record<string, unknown>)[f] = value;
      data.fieldEvidence[f] = evidenceOf(l);
      data.fieldConfidence[f] = l.confidence;
    };
    const fromRules = (f: InvoiceField) => {
      const v = base[f];
      if (v === null) return;
      (data as unknown as Record<string, unknown>)[f] = v;
      if (base.fieldEvidence[f]) data.fieldEvidence[f] = base.fieldEvidence[f];
      if (f in base.fieldConfidence) data.fieldConfidence[f] = base.fieldConfidence[f];
      notes.push(...baseline.notes.filter((n) => n.field === f));
    };
    const disagree = (f: InvoiceField, modelValue: string) => notes.push({ code: 'LOW_CONFIDENCE', field: f, detail: { model: modelValue, rules: base[f] } });

    for (const f of SCALARS) {
      const raw = out[f].value?.trim();
      const l = raw ? locate(raw, out[f].evidence) : null;
      if (!raw || !l) { fromRules(f); continue; }
      if (f === 'invoiceDate') {
        const p = parseDate(raw);
        if (p.kind === 'iso') { put(f, p.value, l); if (base.invoiceDate && base.invoiceDate !== p.value) disagree(f, p.value); }
        else { data.fieldEvidence.invoiceDate = evidenceOf(l); data.fieldConfidence.invoiceDate = null; notes.push({ code: p.kind === 'ambiguous' ? 'DATE_AMBIGUOUS' : 'DATE_UNPARSEABLE', field: 'invoiceDate', raw: clip(raw, 60) }); }
        continue;
      }
      put(f, raw, l);
      if (base[f] && !sameText(base[f], raw)) disagree(f, raw);
    }

    for (const f of AMOUNTS) {
      const raw = out[f].value?.trim();
      const l = raw ? locate(raw, out[f].evidence) : null;
      const amount = raw && l ? parseAmount(raw) : null;
      if (!raw || !l || amount === null) {
        if (raw && l) notes.push({ code: 'AMOUNT_UNPARSEABLE', field: f, raw: clip(raw, 60) });
        fromRules(f);
        continue;
      }
      put(f, amount, l);
      if (base[f] !== null && !new Decimal(base[f]).eq(amount)) disagree(f, amount);
    }

    const code = out.currency.value?.trim().toUpperCase() ?? null;
    if (code && ISO_CURRENCIES.has(code) && (new RegExp(`\\b${code}\\b`, 'i').test(docText) || detectCurrency(docText) === code)) {
      put('currency', code, locate(code, out.currency.evidence) ?? lines.find((l) => detectCurrency(l.text) === code) ?? lines[0]!);
    } else fromRules('currency');

    data.lineItems = this.lineItems(out, docText) ?? base.lineItems;
    if (data.documentType === 'unknown' && base.documentType !== 'unknown' && data.invoiceNumber !== null) data.documentType = base.documentType;
    return { data, notes };
  }

  /** Keeps only rows whose description really occurs in the document; returns null when the model found no usable rows. */
  private lineItems(out: ModelOutput, docText: string): LineItem[] | null {
    const items: LineItem[] = [];
    for (const r of out.lineItems) {
      const description = r.description?.trim() || null;
      if (!description || !docText.includes(fold(description))) continue;
      const num = (v: string | null) => (v ? parseAmount(v) : null);
      const item: LineItem = { description, quantity: num(r.quantity), unitPrice: num(r.unitPrice), taxAmount: num(r.taxAmount), lineTotal: num(r.lineTotal) };
      if (item.quantity || item.unitPrice || item.lineTotal) items.push(item);
    }
    return items.length > 0 ? items : null;
  }
}
