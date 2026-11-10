import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { TokenService } from './token.service.js';

@Module({
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, AuthGuard],
  exports: [AuthGuard, TokenService, AuthService],
})
export class AuthModule {}
