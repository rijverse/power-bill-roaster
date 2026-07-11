module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // *.test.ts only - __tests__/helpers/ holds shared fixtures, not suites.
  testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  // Stop undici pooling a keep-alive socket per ephemeral test port - see the file.
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/helpers/setup-fetch.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/__tests__/**', '!src/**/index.ts'],
};
