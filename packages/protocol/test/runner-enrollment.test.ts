import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validate } from '../src/index.ts';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/runner-enrollment.json', import.meta.url), 'utf8')) as {
  cases: { name: string; schema: string; valid: boolean; value: unknown }[];
};

describe('Runner enrollment shared contracts', () => {
  for (const example of fixture.cases) it(example.name, () => {
    const check = () => validate(example.schema, example.value);
    if (example.valid) expect(check).not.toThrow();
    else expect(check).toThrow();
  });
});
