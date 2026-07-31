import { Kind, type TSchema } from '@sinclair/typebox';
import type { Ctor } from '../types';
import { readControllerMeta, type ResolvedRoute } from '../decorators/metadata';

export interface DocsOptions {
  path?: string;
  info: { title: string; description?: string; version?: string };
  servers?: { url: string }[];
  securitySchemes?: Record<string, unknown>;
  security?: Record<string, unknown[]>[];
}

// TypeBox schemas are JSON Schema plus symbol keys; JSON round-trip strips symbols.
function toJsonSchema(schema: TSchema): unknown {
  return JSON.parse(JSON.stringify(schema));
}

function parameters(route: ResolvedRoute): unknown[] {
  const out: unknown[] = [];
  for (const [source, spot] of [
    ['params', 'path'],
    ['query', 'query'],
  ] as const) {
    const schema = route.schemas[source];
    if (!schema || schema[Kind] !== 'Object') continue;
    const props = (schema as unknown as { properties: Record<string, TSchema> }).properties;
    const required: string[] = (schema as unknown as { required?: string[] }).required ?? [];
    for (const [name, prop] of Object.entries(props)) {
      out.push({
        name,
        in: spot,
        required: spot === 'path' ? true : required.includes(name),
        schema: toJsonSchema(prop),
      });
    }
  }
  return out;
}

function responses(route: ResolvedRoute): Record<string, unknown> {
  const status = String(route.httpCode ?? 200);
  if (!route.returns) return { [status]: { description: 'OK' } };
  return {
    [status]: {
      description: 'OK',
      content: {
        'application/json': { schema: toJsonSchema(route.returns.schema) },
      },
    },
  };
}

export function buildOpenApiDoc(controllers: Ctor[], options: DocsOptions): unknown {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const controller of controllers) {
    const { routes } = readControllerMeta(controller);
    for (const route of routes) {
      const oaPath = route.path.replaceAll(/:([^/]+)/g, '{$1}');
      const operation: Record<string, unknown> = {
        ...(route.docs?.summary && { summary: route.docs.summary }),
        ...(route.docs?.tags && { tags: route.docs.tags }),
        ...(route.isPublic && { security: [] }),
        parameters: parameters(route),
        ...(route.schemas.body && {
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: toJsonSchema(route.schemas.body) },
            },
          },
        }),
        responses: responses(route),
      };
      (paths[oaPath] ??= {})[route.method.toLowerCase()] = operation;
    }
  }
  return {
    openapi: '3.0.3',
    info: { version: '1.0', ...options.info },
    ...(options.servers && { servers: options.servers }),
    paths,
    components: { securitySchemes: options.securitySchemes ?? {} },
    ...(options.security && { security: options.security }),
  };
}
