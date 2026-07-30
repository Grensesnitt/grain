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
});
