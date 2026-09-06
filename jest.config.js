module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // *.test.ts only - __tests__/helpers/ holds shared fixtures, not suites.
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  // The integration suites need a real Postgres, so they are not part of the
  // default run: `bun run test` stays fast and works with nothing installed.
  // `bun run test:integration` (jest.integration.config.js) runs them.
  testPathIgnorePatterns: ['/node_modules/', '\\.integration\\.test\\.ts$'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Stop undici pooling a keep-alive socket per ephemeral test port - see the file.
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/helpers/setup-fetch.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/index.ts'],
  coverageThreshold: {
    global: {
      branches: 55,
      functions: 70,
      lines: 70,
      statements: 70,
    },
  },
};
