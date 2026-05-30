// Lightweight unit-test runner for the app's PURE logic (domain helpers and the
// framework-free chat reducers/formatters). React-Native components aren't
// exercised here — they'd need jest-expo + heavy native mocking; the valuable,
// bug-prone logic has been factored into pure modules that test cleanly under
// ts-jest + node. The Cloud Functions in functions/ have their own jest config.
/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/**/__tests__/**/*.test.ts"],
  testPathIgnorePatterns: ["/node_modules/", "<rootDir>/functions/"],
  moduleFileExtensions: ["ts", "tsx", "js", "json"],
  // Mirror the "@/..." path alias from tsconfig so tests import like the app.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          // Tests don't need strict-unused checks; loosen so test scaffolding
          // doesn't block runs.
          noUnusedLocals: false,
          noUnusedParameters: false,
        },
      },
    ],
  },
  clearMocks: true,
};
