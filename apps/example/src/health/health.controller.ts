import { Controller, Get } from '@grensesnitt/grain';

@Controller('/health')
export class HealthController {
  @Get('/')
  health() {
    return { status: 'ok' };
  }
}
