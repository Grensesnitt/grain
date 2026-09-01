import { expect, test } from 'bun:test';
import { GRAIN_VERSION } from '@grensesnitt/grain';

test('root package resolves via tsconfig paths', () => {
  expect(GRAIN_VERSION).toBe('0.11.0');
});
