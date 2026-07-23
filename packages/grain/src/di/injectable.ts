import 'reflect-metadata'

const INJECTABLE = Symbol.for('grain:injectable')

export function markInjectable(target: Function): void {
  Reflect.defineMetadata(INJECTABLE, true, target)
}

export function isInjectable(target: Function): boolean {
  return Reflect.getMetadata(INJECTABLE, target) === true
}

export function Injectable(): ClassDecorator {
  return (target) => {
    markInjectable(target)
  }
}
