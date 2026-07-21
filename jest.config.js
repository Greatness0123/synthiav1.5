/** @type {import('ts-jest').JestConfigWithTsJest} **/
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: [
    '**/src/world/engine/__tests__/MuJoCoPhysicsEngine.test.ts',
    '**/src/world/engine/__tests__/MJCFHumanoidTemplate.test.ts',
    '**/src/world/engine/__tests__/MuJoCoCollisionAdapter.test.ts',
    '**/src/world/engine/__tests__/MuJoCoObjectManager.test.ts'
  ],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { useESM: true, tsconfig: { module: 'esnext', esModuleInterop: true, skipLibCheck: true, checkJs: false } }],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
