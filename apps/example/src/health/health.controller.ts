import { Controller, Get, Public } from '@grensesnitt/grain';

// @Public is a no-op until app.ts enables global guards — it marks the
// health check as exempt so enabling global auth stays a one-line-pair change
// (the guards option plus its import).
@Controller('/health')
@Public()
export class HealthController {
  @Get('/')
  health() {
    return { status: 'ok' };
  }
}
