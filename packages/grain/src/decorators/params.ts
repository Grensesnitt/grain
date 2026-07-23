import 'reflect-metadata';
import { PARAMS, type ParamMeta } from './metadata';

function createParamDecorator(kind: ParamMeta['kind']) {
  return (name?: string): ParameterDecorator =>
    (target, propertyKey, parameterIndex) => {
      if (propertyKey === undefined) return;
      const ctor = (target as object).constructor;
      const params: ParamMeta[] =
        Reflect.getMetadata(PARAMS, ctor, propertyKey) ?? [];
      params.push({ index: parameterIndex, kind, name });
      Reflect.defineMetadata(PARAMS, params, ctor, propertyKey);
    };
}

export const Body = createParamDecorator('body');
export const Param = createParamDecorator('param');
export const Query = createParamDecorator('query');
export const Ctx = createParamDecorator('ctx');
