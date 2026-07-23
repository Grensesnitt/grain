import { Injectable, UnauthorizedError, type Ctx, type Guard } from '@grensesnitt/grain'
import { TokenService } from './token.service'

@Injectable()
export class AuthGuard implements Guard {
  constructor(private readonly tokens: TokenService) {}

  canActivate(ctx: Ctx): boolean {
    const token = ctx.req.headers.get('authorization')?.replace(/^Bearer /, '')
    if (!this.tokens.isValid(token)) throw new UnauthorizedError()
    ctx.store.token = token
    return true
  }
}
