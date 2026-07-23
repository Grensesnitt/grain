import { Controller, Get, Grain } from '@grensesnitt/grain';

@Controller('/')
class PingController {
  @Get('/ping')
  ping() {
    return { pong: true };
  }
}

new Grain({ controllers: [PingController] }).listen(Number(process.env.PORT));
