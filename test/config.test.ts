import 'reflect-metadata';
import { describe, expect, test } from 'bun:test';
import {
  Config,
  ConfigError,
  Controller,
  Get,
  Grain,
  Injectable,
  resolveConfig,
  t,
} from '@grensesnitt/grain';

class ServerConfig extends Config(
  t.Object({
    PORT: t.Number({ default: 80 }),
    APP_URL: t.String(),
    DEBUG: t.Boolean({ default: false }),
  })
) {}

describe('resolveConfig (standalone)', () => {
  test('coerces strings, applies defaults, returns a typed value', () => {
    const config = resolveConfig(ServerConfig, {
      APP_URL: 'http://localhost:3000',
      PORT: '3001',
      DEBUG: 'true',
    });
    expect(config).toEqual({
      APP_URL: 'http://localhost:3000',
      PORT: 3001,
      DEBUG: true,
    });
  });

  test('missing optional vars fall back to schema defaults', () => {
    const config = resolveConfig(ServerConfig, { APP_URL: 'http://x' });
    expect(config.PORT).toBe(80);
    expect(config.DEBUG).toBe(false);
  });

  test('missing required vars throw ConfigError naming class and var', () => {
    let caught: unknown;
    try {
      resolveConfig(ServerConfig, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const err = caught as ConfigError;
    expect(err.issues).toHaveLength(1);
    expect(err.issues[0].configName).toBe('ServerConfig');
    expect(err.issues[0].path).toBe('APP_URL');
    expect(err.message).toContain('ServerConfig APP_URL');
  });

  test('an empty string counts as unset', () => {
    expect(() => resolveConfig(ServerConfig, { APP_URL: '' })).toThrow(
      ConfigError
    );
  });

  test('undeclared env keys are not leaked onto the config value', () => {
    const config = resolveConfig(ServerConfig, {
      APP_URL: 'http://x',
      SECRET_NEIGHBOR: 'nope',
    });
    expect('SECRET_NEIGHBOR' in config).toBe(false);
  });
});

describe('refine', () => {
  class EmailConfig extends Config(
    t.Object({
      EMAIL_DISABLED: t.Boolean({ default: false }),
      MANDRILL_API_KEY: t.Optional(t.String()),
    }),
    {
      refine: (config) =>
        !config.EMAIL_DISABLED && !config.MANDRILL_API_KEY
          ? ['MANDRILL_API_KEY is required unless EMAIL_DISABLED']
          : [],
    }
  ) {}

  test('passes when the conditional requirement is satisfied', () => {
    expect(resolveConfig(EmailConfig, { EMAIL_DISABLED: 'true' })).toEqual({
      EMAIL_DISABLED: true,
    });
    expect(
      resolveConfig(EmailConfig, { MANDRILL_API_KEY: 'key' }).MANDRILL_API_KEY
    ).toBe('key');
  });

  test('refine messages become issues on the owning class', () => {
    let caught: unknown;
    try {
      resolveConfig(EmailConfig, {});
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect((caught as ConfigError).issues[0]).toEqual({
      configName: 'EmailConfig',
      path: '',
      message: 'MANDRILL_API_KEY is required unless EMAIL_DISABLED',
    });
  });
});

describe('DI integration', () => {
  @Injectable()
  class UsesConfig {
    constructor(readonly config: ServerConfig) {}
  }

  @Controller('/cfg')
  class CfgController {
    constructor(readonly svc: UsesConfig) {}
    @Get('/')
    read() {
      return { port: this.svc.config.PORT, url: this.svc.config.APP_URL };
    }
  }

  test('config classes inject through the container without @Injectable', async () => {
    const app = new Grain({
      controllers: [CfgController],
      env: { APP_URL: 'http://a', PORT: '3005' },
    });
    const res = await app.handle(new Request('http://localhost/cfg'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ port: 3005, url: 'http://a' });
  });

  test('a useValue provider overrides env validation entirely', async () => {
    const app = new Grain({
      controllers: [CfgController],
      providers: [
        {
          provide: ServerConfig,
          useValue: { PORT: 1, APP_URL: 'http://override', DEBUG: false },
        },
      ],
      env: {},
    });
    const res = await app.handle(new Request('http://localhost/cfg'));
    expect(await res.json()).toEqual({ port: 1, url: 'http://override' });
  });

  test('boot aggregates issues from every demanded config class', async () => {
    class AConfig extends Config(t.Object({ A_VAR: t.String() })) {}
    class BConfig extends Config(t.Object({ B_VAR: t.String() })) {}

    @Controller('/a')
    class AController {
      constructor(readonly config: AConfig) {}
      @Get('/')
      go() {
        return {};
      }
    }

    @Controller('/b')
    class BController {
      constructor(readonly config: BConfig) {}
      @Get('/')
      go() {
        return {};
      }
    }

    const app = new Grain({
      controllers: [AController, BController],
      env: {},
    });
    let caught: unknown;
    try {
      await app.handle(new Request('http://localhost/a'));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    const err = caught as ConfigError;
    expect(err.issues.map((i) => `${i.configName}.${i.path}`)).toEqual([
      'AConfig.A_VAR',
      'BConfig.B_VAR',
    ]);
  });

  test('a config class nothing injects is never demanded from the env', async () => {
    class UnusedConfig extends Config(t.Object({ MUST_BE_SET: t.String() })) {}

    @Controller('/plain')
    class PlainController {
      @Get('/')
      go() {
        return { ok: true };
      }
    }

    // The same class fails when demanded directly...
    expect(() => resolveConfig(UnusedConfig, {})).toThrow(ConfigError);
    // ...but an app whose graph never injects it boots fine without the var.
    const app = new Grain({ controllers: [PlainController], env: {} });
    const res = await app.handle(new Request('http://localhost/plain'));
    expect(res.status).toBe(200);
  });
});
