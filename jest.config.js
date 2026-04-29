/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    // franc-min is ESM-only; ts-jest's CommonJS transform can't load it.
    '^franc-min$': '<rootDir>/src/__mocks__/franc-min.ts',
  },
  testEnvironment: 'node',
};
