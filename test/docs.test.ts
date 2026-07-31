import { describe, expect, test } from 'bun:test';
import {
  Body,
  Controller,
  Docs,
  Dto,
  Get,
  Grain,
  HttpCode,
  Param,
  Post,
  Public,
  Query,
  t,
} from '../src';

class CreateThingDto extends Dto(
  t.Object(
    { name: t.String({ minLength: 1 }) },
    { additionalProperties: false }
  )
) {}

class ThingsQueryDto extends Dto(
  t.Object(
    { page: t.Optional(t.Number({ default: 1 })) },
    { additionalProperties: false }
  )
) {}

const ThingEnvelope = t.Object({
  meta: t.Null(),
  data: t.Object({ name: t.String() }),
});

@Controller('/things')
class ThingsController {
  @Get('/')
  @Docs({ tags: ['things'], summary: 'List things' })
  list(@Query() query: ThingsQueryDto) {
    return { meta: null, data: [query.page] };
  }

  @Get('/:id')
  one(@Param('id') id: number) {
    return { meta: null, data: id };
  }

  @Post('/')
  @HttpCode(201)
  @Public()
  @Docs({ tags: ['things'], response: { 201: ThingEnvelope } })
  create(@Body() body: CreateThingDto) {
    return { meta: null, data: body };
  }
}

const app = () =>
  new Grain({
    controllers: [ThingsController],
    docs: {
      info: { title: 'Test API', version: '1.0' },
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      security: [{ bearer: [] }],
    },
  });

describe('openapi docs', () => {
  test('serves HTML at /docs and JSON at /docs/json', async () => {
    const html = await app().handle(new Request('http://x/docs'));
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');
    const json = await app().handle(new Request('http://x/docs/json'));
    expect(json.status).toBe(200);
    const doc = (await json.json()) as any;
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBe('Test API');
  });

  test('document contains paths, params, body, tags, status codes and security', async () => {
    const res = await app().handle(new Request('http://x/docs/json'));
    const doc = (await res.json()) as any;
    expect(doc.paths['/things/{id}'].get.parameters[0]).toMatchObject({
      name: 'id',
      in: 'path',
      required: true,
    });
    const post = doc.paths['/things'].post;
    expect(
      post.requestBody.content['application/json'].schema.properties.name
    ).toBeDefined();
    expect(
      post.responses['201'].content['application/json'].schema
    ).toBeDefined();
    expect(post.security).toEqual([]); // @Public route
    expect(post.tags).toEqual(['things']);
    const list = doc.paths['/things'].get;
    expect(list.summary).toBe('List things');
    expect(
      list.parameters.some((p: any) => p.name === 'page' && p.in === 'query')
    ).toBe(true);
    expect(list.security).toBeUndefined(); // inherits global security
    expect(doc.components.securitySchemes.bearer.scheme).toBe('bearer');
    expect(doc.security).toEqual([{ bearer: [] }]);
  });

  test('onResponse hooks and CORS headers both apply to the docs HTML route', async () => {
    const withHooks = new Grain({
      controllers: [],
      docs: { info: { title: 'Test API', version: '1.0' } },
      cors: { origin: true },
    }).onResponse((res) => {
      res.headers.set('x-marker', 'on');
    });
    const res = await withHooks.handle(
      new Request('http://x/docs', {
        headers: { origin: 'http://app.example' },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-marker')).toBe('on');
    expect(res.headers.get('access-control-allow-origin')).toBe(
      'http://app.example'
    );
  });

  test('docs HTML embeds a relative spec URL, not an absolute one', async () => {
    const res = await app().handle(new Request('http://x/docs'));
    const html = await res.text();
    expect(html).toContain('url: "docs/json"');
    expect(html).not.toContain("'/docs/json'");
    expect(html).not.toContain('"/docs/json"');
  });

  test('relative doc URL resolves correctly behind a prefix-stripping proxy', () => {
    // Mirrors the browser's own relative-URL resolution: the page is served
    // at .../docs with no trailing slash, so `docs/json` resolves against
    // the *parent* of docs, landing on a sibling path — not a nested one —
    // regardless of what prefix a reverse proxy puts in front of it.
    expect(new URL('docs/json', 'http://x/docs').pathname).toBe('/docs/json');
    expect(
      new URL('docs/json', 'http://gateway.internal/api/core/docs').pathname
    ).toBe('/api/core/docs/json');
  });

  test('a custom docs path yields a relative spec URL from its own last segment', async () => {
    const custom = new Grain({
      controllers: [],
      docs: { path: '/internal/apidocs', info: { title: 'Test API' } },
    });
    const res = await custom.handle(new Request('http://x/internal/apidocs'));
    const html = await res.text();
    expect(html).toContain('url: "apidocs/json"');
    expect(html).not.toContain('/internal/apidocs/json');
  });

  test('title is HTML-escaped and the spec URL is JSON-encoded for the script context', async () => {
    const evil = new Grain({
      controllers: [],
      docs: { info: { title: '</script><script>alert(1)</script>' } },
    });
    const res = await evil.handle(new Request('http://x/docs'));
    const html = await res.text();
    expect(html).not.toContain(
      '<title></script><script>alert(1)</script></title>'
    );
    expect(html).toContain(
      '<title>&lt;/script&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>'
    );
  });

  test('throws when a controller route collides with the docs path', async () => {
    @Controller('/docs')
    class CollidingController {
      @Get('/')
      clash() {
        return { meta: null, data: null };
      }
    }
    const collide = new Grain({
      controllers: [CollidingController],
      docs: { info: { title: 'Test API' } },
    });
    // compile() runs lazily inside async handle(), so the boot error surfaces
    // as a rejected promise rather than a sync throw.
    await expect(collide.handle(new Request('http://x/docs'))).rejects.toThrow(
      /Duplicate route/
    );
  });
});
