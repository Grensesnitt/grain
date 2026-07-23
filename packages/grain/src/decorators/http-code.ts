import 'reflect-metadata';
import { HTTP_CODE } from './metadata';

export function HttpCode(code: number): MethodDecorator {
  return (target, propertyKey) => {
    Reflect.defineMetadata(HTTP_CODE, code, target.constructor, propertyKey);
  };
}
