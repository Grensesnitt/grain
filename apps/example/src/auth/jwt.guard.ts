import {
  Injectable,
  UnauthorizedError,
  type Ctx,
  type Guard,
} from '@grensesnitt/grain';
import { UserService } from '../users/user.service';
import { JwtConfigError, JwtService } from './jwt.service';

@Injectable()
export class JwtGuard implements Guard {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UserService
  ) {}

  async canActivate(ctx: Ctx): Promise<boolean> {
    const header = ctx.req.headers.get('authorization');
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedError();
    let sub: string;
    try {
      ({ sub } = await this.jwt.verify(header.slice('Bearer '.length)));
    } catch (err) {
      // configuration errors stay loud (500); bad tokens become 401
      if (err instanceof JwtConfigError) throw err;
      throw new UnauthorizedError();
    }
    try {
      ctx.store.user = this.users.find(Number(sub));
    } catch {
      // user deleted after the token was issued
      throw new UnauthorizedError();
    }
    return true;
  }
}
