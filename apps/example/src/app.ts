import { Grain } from '@grensesnitt/grain';
import { AuthController } from './auth/auth.controller';
import { HealthController } from './health/health.controller';
import { UserController } from './users/user.controller';
// import { JwtGuard } from './auth/jwt.guard';

export function buildApp(): Grain {
  const app = new Grain({
    controllers: [HealthController, UserController, AuthController],
    // --- Global JWT auth (uncomment this and the JwtGuard import above) ---
    // Every route then requires `Authorization: Bearer <jwt>` except those
    // marked @Public (the health check and /auth/login). Note that the
    // machine routes (POST/DELETE /users) would require BOTH the JWT and the
    // X-API-TOKEN header — mark them @Public instead if the API token alone
    // should keep sufficing.
    // guards: [JwtGuard],
  });
  app.onRequest((ctx) => {
    ctx.store.startedAt = performance.now();
  });
  app.onError((err) => {
    if (!(err instanceof Error) || !('statusCode' in err)) {
      console.error('[example] unhandled error:', err);
    }
  });
  return app;
}
