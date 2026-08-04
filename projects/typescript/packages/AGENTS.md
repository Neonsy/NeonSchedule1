# TypeScript package imports

These rules apply to every package under this directory.

- Import another workspace package by its package name, such as `@neonschedule1/core`
- Import another file in the same package through a private `#...` alias
- Define every private alias in the package's `package.json` `imports` map
- Configure TypeScript and Vitest to resolve the same alias
- Ensure that built JavaScript resolves the alias through Node.js
- Apply the same rules to `export ... from` declarations
- Use ordinary paths when code reads or writes data files

Existing relative imports may remain until the current task changes them.
When a required alias is missing, add the smallest complete alias configuration before using it.
