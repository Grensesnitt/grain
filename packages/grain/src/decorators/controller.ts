import 'reflect-metadata'
import { markInjectable } from '../di/injectable'
import { CONTROLLER_PREFIX } from './metadata'

export function Controller(prefix = '/'): ClassDecorator {
  return (target) => {
    markInjectable(target)
    Reflect.defineMetadata(CONTROLLER_PREFIX, prefix, target)
  }
}
