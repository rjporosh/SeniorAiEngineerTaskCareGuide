import { Inject, Injectable, type CallHandler, type ExecutionContext, type NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map, type Observable } from 'rxjs';
import { success } from './envelope.js';
import { IS_RAW } from './decorators.js';
import { currentCorrelationId } from './request-context.js';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (this.reflector.getAllAndOverride<boolean>(IS_RAW, [ctx.getHandler(), ctx.getClass()])) return next.handle();
    return next.handle().pipe(map((data: unknown) => success(data ?? null, currentCorrelationId())));
  }
}
