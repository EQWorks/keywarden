module.exports = {
  "env": {
    "browser": false,
    "node": true,
    "es6": true,
  },
  "extends": [
    "eslint:recommended",
  ],
  "parserOptions": {
    ecmaVersion: 2017,
    "sourceType": "module",
  },
  "rules": {
    "indent": [
      "error",
      2,
    ],
    "linebreak-style": [
      "error",
      "unix",
    ],
    "quotes": [
      "error",
      "single",
    ],
    "semi": [
      "error",
      "never",
    ],
    "comma-dangle": [
      "error",
      "never",
    ],
    "no-console": [
      "warn"
    ],
    "comma-dangle": [
      "error",
      "only-multiline"
    ],
  },
}
