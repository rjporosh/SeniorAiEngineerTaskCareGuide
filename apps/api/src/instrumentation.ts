// Loaded with `node --import ./dist/instrumentation.js` BEFORE the application so libraries can be patched.
// Tracing is opt-in: it starts only when an OTLP endpoint is configured (OTEL_EXPORTER_OTLP_ENDPOINT).
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { AmqplibInstrumentation } from '@opentelemetry/instrumentation-amqplib';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { NodeSDK } from '@opentelemetry/sdk-node';

if (process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] && process.env['OTEL_SDK_DISABLED'] !== 'true') {
  const sdk = new NodeSDK({
    serviceName: process.env['OTEL_SERVICE_NAME'] ?? 'docint-api',
    traceExporter: new OTLPTraceExporter(),
    instrumentations: [
      new HttpInstrumentation({ ignoreIncomingRequestHook: (req) => /\/health\/|\/metrics/.test(req.url ?? '') }),
      new ExpressInstrumentation(), new PgInstrumentation(), new AmqplibInstrumentation(), new IORedisInstrumentation(),
    ],
  });
  sdk.start();
  const stop = () => { void sdk.shutdown().catch(() => undefined); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
