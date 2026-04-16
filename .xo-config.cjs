module.exports = {
  prettier: false,
  space: 2,
  typescript: true,
  envs: ['browser', 'node'],
  globals: ['afterEach', 'describe', 'expect', 'it', 'vi'],
  rules: {
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/indent': 'off',
    '@typescript-eslint/naming-convention': 'off',
    '@typescript-eslint/no-base-to-string': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/parameter-properties': 'off',
    '@typescript-eslint/triple-slash-reference': 'off',
    'import/no-extraneous-dependencies': 'off',
    'import/order': 'off',
    'no-await-in-loop': 'off',
    'no-mixed-operators': 'off',
    'object-curly-newline': 'off',
    'unicorn/filename-case': 'off',
    'unicorn/numeric-separators-style': 'off',
    'unicorn/prefer-code-point': 'off',
    'unicorn/prefer-structured-clone': 'off',
    'unicorn/prefer-top-level-await': 'off',
    'unicorn/prevent-abbreviations': 'off'
  }
};

