module.exports = {
  preset: 'ts-jest/presets/default-esm', testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'], testMatch: ['<rootDir>/src/**/*.spec.ts'],
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  transform: { '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: 'tsconfig.json' }] },
  clearMocks: true, restoreMocks: true,
  collectCoverageFrom: [
    'src/**/*.ts', '!src/**/*.spec.ts', '!src/**/testing/**', '!src/**/*.dto.ts', '!src/**/*.ports.ts',
    '!src/server.ts', '!src/bootstrap.ts', '!src/modules/registry.ts',
    '!src/common/workers/worker-protocol.ts', '!src/common/utils/email-sender.ts'
  ],
  coverageThreshold: { global: { branches: 80, functions: 85, lines: 85, statements: 85 } }
};
