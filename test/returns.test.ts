import { describe, expect, test } from 'bun:test';
import {
  Controller,
  Ctx,
  Get,
  Grain,
  HttpCode,
  Post,
  Returns,
  t,
} from '../src';

const ItemEnvelope = t.Object({
  meta: t.Null(),
  data: t.Object({
    id: t.Number(),
    name: t.String(),
    tags: t.Array(t.Object({ label: t.String() })),
    blob: t.Optional(t.Any()),
  }),
});

const leakyItem = () => ({
  id: 1,
  name: 'a',
  password: 'hash',
  deleted_at: null,
  tags: [{ label: 'x', internal: true }],
  blob: { anything: 'goes', nested: { deep: 1 } },
});

describe('@Returns', () => {
  test('cleans undeclared fields recursively; declared and t.Any fields survive', async () => {
    @Controller('/r')
    class RController {
      @Get('/item')
      @Returns(ItemEnvelope)
      item() {
        return { meta: null, data: leakyItem() };
      }
    }
    const res = await new Grain({ controllers: [RController] }).handle(
      new Request('http://x/r/item')
    );
    expect(await res.json()).toEqual({
      meta: null,
      data: {
        id: 1,
        name: 'a',
        tags: [{ label: 'x' }],
        blob: { anything: 'goes', nested: { deep: 1 } },
      },
    });
  });

  test('does not mutate the handler result object (clone before Clean)', async () => {
    const shared = { meta: null, data: leakyItem() };
    @Controller('/r')
    class RController {
      @Get('/shared')
      @Returns(ItemEnvelope)
      sharedItem() {
        return shared;
      }
    }
    await new Grain({ controllers: [RController] }).handle(
      new Request('http://x/r/shared')
    );
    expect((shared.data as Record<string, unknown>).password).toBe('hash');
    expect((shared.data.tags[0] as Record<string, unknown>).internal).toBe(
      true
    );
  });

  test('@Returns(201, schema) sets the status code without @HttpCode', async () => {
    @Controller('/r')
    class RController {
      @Post('/create')
      @Returns(201, ItemEnvelope)
      create() {
        return { meta: null, data: leakyItem() };
      }
    }
    const res = await new Grain({ controllers: [RController] }).handle(
      new Request('http://x/r/create', { method: 'POST' })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.password).toBeUndefined();
  });

  test('matching @HttpCode + @Returns code coexist; conflicting codes throw at boot', async () => {
    @Controller('/ok')
    class OkController {
      @Post('/')
      @HttpCode(201)
      @Returns(201, ItemEnvelope)
      create() {
        return { meta: null, data: leakyItem() };
      }
    }
    const ok = await new Grain({ controllers: [OkController] }).handle(
      new Request('http://x/ok', { method: 'POST' })
    );
    expect(ok.status).toBe(201);

    @Controller('/bad')
    class BadController {
      @Post('/')
      @HttpCode(200)
      @Returns(201, ItemEnvelope)
      create() {
        return { meta: null, data: leakyItem() };
      }
    }
    await expect(
      new Grain({ controllers: [BadController] }).handle(
        new Request('http://x/bad', { method: 'POST' })
      )
    ).rejects.toThrow(/Conflicting status codes/);
  });

  test('code-less @Returns keys its status off @HttpCode while still cleaning the body', async () => {
    @Controller('/r')
    class RController {
      @Post('/create-coded')
      @HttpCode(201)
      @Returns(ItemEnvelope)
      create() {
        return { meta: null, data: leakyItem() };
      }
    }
    const res = await new Grain({ controllers: [RController] }).handle(
      new Request('http://x/r/create-coded', { method: 'POST' })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.data.password).toBeUndefined();
  });

  test('raw Response and undefined returns are untouched', async () => {
    @Controller('/r')
    class RController {
      @Get('/raw')
      @Returns(ItemEnvelope)
      raw() {
        return new Response('opaque', { status: 418 });
      }

      @Get('/empty')
      @Returns(ItemEnvelope)
      empty(@Ctx() _ctx: Ctx) {
        return undefined;
      }
    }
    const app = new Grain({ controllers: [RController] });
    const raw = await app.handle(new Request('http://x/r/raw'));
    expect(raw.status).toBe(418);
    expect(await raw.text()).toBe('opaque');
    const empty = await app.handle(new Request('http://x/r/empty'));
    expect(empty.status).toBe(204);
  });

  test('@Returns(code) with no schema throws a fail-fast error (JS/any misuse)', () => {
    expect(() => Returns(201 as never)).toThrow(
      '@Returns(code) requires a schema: @Returns(code, schema)'
    );
  });

  test('duplicate @Returns on the same method throws at class-definition time', () => {
    // Method decorators run bottom-up while the class body is being defined,
    // so the throw happens synchronously as the class is declared.
    expect(() => {
      @Controller('/dup')
      class DupController {
        @Get('/x')
        @Returns(ItemEnvelope)
        @Returns(ItemEnvelope)
        x() {
          return { meta: null, data: leakyItem() };
        }
      }
      return DupController;
    }).toThrow(/Duplicate @Returns on DupController\.x/);
  });
});
