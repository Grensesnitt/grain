import { FormatRegistry } from '@sinclair/typebox';

// TypeBox ships `format` keyword support but does not register any format
// checkers itself — an unregistered format (e.g. `t.String({ format: 'email' })`)
// fails every value with "Unknown format 'email'". Grain re-exports `t` as the
// schema-building API, so it registers the common formats consumers reach for
// out of the box, the same way `reflect-metadata` is a side-effect import here.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

if (!FormatRegistry.Has('email')) {
  FormatRegistry.Set('email', (value) => EMAIL.test(value));
}
