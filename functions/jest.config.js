/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          // Tests don't need strict-unused checks; loosen so test scaffolding
          // (unused imports during refactors) doesn't block runs.
          noUnusedLocals: false,
          noUnusedParameters: false,
        },
      },
    ],
  },
  clearMocks: true,
};
