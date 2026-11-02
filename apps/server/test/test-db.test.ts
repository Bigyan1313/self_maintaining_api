import { describe, expect, it } from 'vitest';
import { TEST_DATABASE_NAME, testDatabaseUrl } from '../src/infra/db/test-db.js';

describe('testDatabaseUrl (never touches the dev DB)', () => {
  it('derives sma_test from DATABASE_URL', () => {
    const url = new URL(testDatabaseUrl({ DATABASE_URL: 'postgres://u:p@localhost:5432/sma' }));
    expect(url.pathname).toBe(`/${TEST_DATABASE_NAME}`);
    expect(url.host).toBe('localhost:5432');
  });

  it('uses TEST_DATABASE_URL when it names a _test database', () => {
    const url = testDatabaseUrl({
      DATABASE_URL: 'postgres://u:p@localhost/sma',
      TEST_DATABASE_URL: 'postgres://u:p@db:5433/ci_test',
    });
    expect(new URL(url).pathname).toBe('/ci_test');
  });

  it('refuses a TEST_DATABASE_URL that is not a _test database', () => {
    expect(() => testDatabaseUrl({ TEST_DATABASE_URL: 'postgres://u:p@localhost/sma' })).toThrow(
      /Refusing/,
    );
  });

  it('fails clearly when no URL is configured', () => {
    expect(() => testDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});
