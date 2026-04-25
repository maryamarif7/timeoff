module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {     
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
  collectCoverageFrom: ['src/**/*.(t|j)s', '!src/main.ts'],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: { lines: 90, functions: 90, branches: 85 },
    './src/requests/requests.service.ts': { lines: 100 },
    './src/sync/': { lines: 95 },
  },
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/'],
};