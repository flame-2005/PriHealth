module.exports = {
  preset: '@react-native/jest-preset',
  moduleNameMapper: {
    // The React Native resolver picks this package's ESM (.mjs) build, which babel-jest does not transform.
    '^lucide-react-native$': '<rootDir>/node_modules/lucide-react-native/dist/cjs/lucide-react-native.js',
  },
  // The preset's list, plus the navigation and native UI packages that screens.test.tsx pulls in.
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage|@react-navigation|react-native-[a-z-]+)/)',
  ],
};
