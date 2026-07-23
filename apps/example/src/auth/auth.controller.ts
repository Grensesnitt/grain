import {
  Body,
  Controller,
  Ctx,
  Get,
  Post,
  UnauthorizedError,
  UseGuard,
  t,
  type Static,
} from '@grensesnitt/grain';
import { UserService } from '../users/user.service';
import { JwtGuard } from './jwt.guard';
import { JwtService } from './jwt.service';

const Login = t.Object({
  email: t.String({ format: 'email' }),
  password: t.String(),
});

@Controller('/auth')
export class AuthController {
  constructor(
    private readonly users: UserService,
    private readonly jwt: JwtService
  ) {}

  @Post('/login', { body: Login })
  async login(@Body() body: Static<typeof Login>) {
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
