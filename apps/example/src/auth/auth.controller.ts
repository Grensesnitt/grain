import {
  Body,
  Controller,
  Ctx,
  Dto,
  Get,
  Post,
  Public,
  UnauthorizedError,
  UseGuard,
  t,
} from '@grensesnitt/grain';
import { UserService } from '../users/user.service';
import { JwtGuard } from './jwt.guard';
import { JwtService } from './jwt.service';

class LoginDto extends Dto(
  t.Object({
    email: t.String({ format: 'email' }),
    password: t.String(),
  })
) {}

@Controller('/auth')
export class AuthController {
  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService
  ) {}

  @Post('/login')
  // @Public is a no-op until app.ts enables global guards; login must stay
  // reachable without a token, or nobody could ever obtain one.
  @Public()
  async login(@Body() body: LoginDto) {
    const user = await this.users.verifyCredentials(body.email, body.password);
    if (!user) throw new UnauthorizedError('invalid credentials');
    return { token: await this.jwt.sign(user) };
  }

  @Get('/me')
  @UseGuard(JwtGuard)
  me(@Ctx() ctx: Ctx) {
    return ctx.store.user;
  }
}
