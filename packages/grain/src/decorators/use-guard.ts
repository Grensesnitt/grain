import 'reflect-metadata'
import type { Ctor, Guard } from '../types'
import { GUARDS } from './metadata'

export function UseGuard(...guards: Ctor<Guard>[]): ClassDecorator & MethodDecorator {
  return (target: Function | object, propertyKey?: string | symbol) => {
    if (propertyKey === undefined) {
      const existing: Ctor<Guard>[] = Reflect.getMetadata(GUARDS, target as Function) ?? []
      Reflect.defineMetadata(GUARDS, [...existing, ...guards], target as Function)
    } else {
      const ctor = (target as object).constructor
      const existing: Ctor<Guard>[] = Reflect.getMetadata(GUARDS, ctor, propertyKey) ?? []
      Reflect.defineMetadata(GUARDS, [...existing, ...guards], ctor, propertyKey)
    }
  }
}
