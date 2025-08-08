import standardConfig from 'eslint-config-standard-kit'

export default [
  ...standardConfig({
    prettier: true,
    sortImports: true,
    node: true,
    react: true,
    typescript: true
  }),

  // Global ignores need to be in their own block:
  {
    ignores: ['**/lib/**', '**/dist/**']
  }
]
