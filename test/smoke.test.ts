import { expect, test } from 'bun:test';
import { GRAIN_VERSION } from '@grensesnitt/grain';

test('workspace resolves the grain package', () => {
  expect(GRAIN_VERSION).toBe('0.2.0');
});
