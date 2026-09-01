import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
  Controller,
  createParamDecorator,
  Get,
  Grain,
  Param,
  Public,
  UseGuard,
  type Ctx,
  type Guard,
} from '@grensesnitt/grain';
import { Injectable } from '../src/di/injectable';

interface TestUser {
  id: number;
  username: string;
}

const CurrentUser = createParamDecorator((ctx) => ctx.store.user);

@Injectable()
class StashUserGuard implements Guard {
  canActivate(ctx: Ctx): boolean {
    ctx.store.user = { id: 7, username: 'stashed' } satisfies TestUser;
    return true;
  }
}

@Controller('/things')
@UseGuard(StashUserGuard)
class ThingsController {
  @Get('/me')
  me(@CurrentUser() user: TestUser) {
    return { id: user.id, username: user.username };
  }

  // A custom slot mixed with validated slots: @Param('id') still derives its
  // coercing schema, the custom slot stays out of schema derivation.
  @Get('/:id')
  read(@Param('id') id: number, @CurrentUser() user: TestUser) {
    return { id, by: user.username };
  }
}

@Controller('/plain')
class PlainController {
  @Get('/')
  @Public()
  go(@CurrentUser() user: TestUser | undefined) {
    return { hasUser: user !== undefined };
  }
}

describe('createParamDecorator', () => {
  const app = new Grain({ controllers: [ThingsController, PlainController] });

  test('injects the factory result into the handler', async () => {
    const res = await app.handle(new Request('http://localhost/things/me'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 7, username: 'stashed' });
  });

  test('mixes with validated params without disturbing their schemas', async () => {
    const ok = await app.handle(new Request('http://localhost/things/42'));
    expect(await ok.json()).toEqual({ id: 42, by: 'stashed' });
    const bad = await app.handle(new Request('http://localhost/things/nan'));
    expect(bad.status).toBe(400);
  });

  test('yields undefined when nothing populated the store', async () => {
    const res = await app.handle(new Request('http://localhost/plain'));
    expect(await res.json()).toEqual({ hasUser: false });
  });
});
