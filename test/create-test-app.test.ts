import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
  Config,
  Controller,
  createTestApp,
  Get,
  Grain,
  Logger,
  Public,
  t,
  type GrainOptions,
} from '@grensesnitt/grain';
import { Injectable } from '../src/di/injectable';
import { Container } from '../src/di/container';

@Injectable()
class Mailer {
  deliver(): string {
    return 'real';
  }
}

@Controller('/mail')
@Public()
class MailController {
  constructor(readonly mailer: Mailer) {}
  @Get('/')
  go() {
    return { delivered: this.mailer.deliver() };
  }
}

const baseOptions: GrainOptions = {
  controllers: [MailController],
  providers: [Mailer],
};

describe('createTestApp', () => {
  test('a useValue override replaces a plain-class provider', async () => {
    const app = createTestApp(baseOptions, {
      providers: [{ provide: Mailer, useValue: { deliver: () => 'fake' } }],
    });
    const res = await app.handle(new Request('http://x/mail'));
    expect(await res.json()).toEqual({ delivered: 'fake' });
    // The original options object is untouched.
    expect(baseOptions.providers).toHaveLength(1);
  });

  test('without overrides the app behaves like the original', async () => {
    const app = createTestApp(baseOptions);
    const res = await app.handle(new Request('http://x/mail'));
    expect(await res.json()).toEqual({ delivered: 'real' });
  });

  test('env override feeds Config classes', async () => {
    class MailConfig extends Config(t.Object({ MAIL_FROM: t.String() })) {}

    @Controller('/cfg')
    @Public()
    class CfgController {
      constructor(readonly config: MailConfig) {}
      @Get('/')
      go() {
        return { from: this.config.MAIL_FROM };
      }
    }

    const app = createTestApp(
      { controllers: [CfgController], env: {} },
      { env: { MAIL_FROM: 'test@example.com' } }
    );
    const res = await app.handle(new Request('http://x/cfg'));
    expect(await res.json()).toEqual({ from: 'test@example.com' });
  });

  test('an explicit overrides.logger wins over the quiet default', async () => {
    const lines: string[] = [];
    const app = createTestApp(baseOptions, {
      logger: new Logger({ write: (line) => lines.push(line) }),
    });
    await app.handle(new Request('http://x/mail'));
    expect(lines.some((l) => l.includes('"msg":"request"'))).toBe(true);
  });
});

describe('provider re-registration is last-wins across kinds', () => {
  test('useClass after useValue wins (and vice versa)', () => {
    class Token {
      kind = 'token';
    }
    @Injectable()
    class Sub extends Token {
      kind = 'sub';
    }

    const a = new Container();
    a.register({ provide: Token, useValue: { kind: 'value' } });
    a.register({ provide: Token, useClass: Sub });
    expect(a.resolve(Token).kind).toBe('sub');

    const b = new Container();
    b.register({ provide: Token, useClass: Sub });
    b.register({ provide: Token, useValue: { kind: 'value' } });
    expect(b.resolve(Token).kind).toBe('value');
  });

  test('useFactory after useValue wins', () => {
    class Token {}
    const c = new Container();
    c.register({ provide: Token, useValue: { made: 'value' } });
    c.register({ provide: Token, useFactory: () => ({ made: 'factory' }) });
    expect((c.resolve(Token) as { made: string }).made).toBe('factory');
  });

  test('a later provider on a Grain app overrides an earlier one', async () => {
    const app = new Grain({
      controllers: [MailController],
      providers: [
        Mailer,
        { provide: Mailer, useValue: { deliver: () => 'override' } },
      ],
    });
    const res = await app.handle(new Request('http://x/mail'));
    expect(await res.json()).toEqual({ delivered: 'override' });
  });
});
