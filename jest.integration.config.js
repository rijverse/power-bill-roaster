const base = require('./jest.config.js');

// The integration suites: real Postgres, one throwaway database per run (see
// __tests__/helpers/pg.ts). Separate from the default config so `bun run test`
// needs no database, while these can still be run locally and in CI where one
// exists. DATABASE_URL points at the server; the tests never touch the database
// named in it, only CREATE/DROP their own.
module.exports = {
  ...base,
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/__tests__/**/*.integration.test.ts'],
  // Pick up DATABASE_URL from .env the way the app does. In CI it comes from the
  // job env instead, which dotenv leaves alone.
  setupFiles: ['dotenv/config'],
  // Migrating a fresh database costs a few seconds before the first assertion.
  testTimeout: 60000,
  // Coverage thresholds are tuned for the unit run; these suites are about
  // constraints, not breadth.
  coverageThreshold: undefined,
};
