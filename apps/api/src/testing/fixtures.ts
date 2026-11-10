import type { InvoiceData } from '../domain/types.js';

export const invoiceFixture = (over: Partial<InvoiceData> = {}): InvoiceData => ({
  schemaVersion: '1.0', documentType: 'invoice',
  invoiceNumber: 'INV-1001', invoiceDate: '2026-03-15', supplierName: 'Acme Supplies Ltd', customerName: 'Globex',
  subtotal: '100.00', taxAmount: '10.00', totalAmount: '110.00', currency: 'USD',
  lineItems: [{ description: 'Widget', quantity: '2', unitPrice: '50.00', taxAmount: '10.00', lineTotal: '100.00' }],
  fieldEvidence: { invoiceNumber: { sourcePage: 1, sourceSheet: null, sourceCell: null, text: 'Invoice No: INV-1001' } },
  fieldConfidence: { invoiceNumber: 0.9 }, requiresManualReview: false, ...over,
});
