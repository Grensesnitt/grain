import { Grain } from '@grensesnitt/grain';
import { HealthController } from './health/health.controller';
import { UserController } from './users/user.controller';

export function buildApp(): Grain {
  const app = new Grain({
    controllers: [HealthController, UserController],
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
