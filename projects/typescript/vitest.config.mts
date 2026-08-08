import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const isCi = !['', '0', 'false'].includes(process.env.CI?.toLowerCase() ?? '');

export default defineConfig({
    test: {
        maxWorkers: isCi ? undefined : '50%',
        projects: [
            {
                extends: true,
                root: fileURLToPath(new URL('packages/data-compiler', import.meta.url)),
                test: { name: 'data-compiler' },
                resolve: {
                    alias: {
                        '#core': fileURLToPath(new URL('packages/core/src', import.meta.url)),
                        '#data-compiler': fileURLToPath(new URL(
                            'packages/data-compiler/src',
                            import.meta.url
                        )),
                        '@neonschedule1/core': fileURLToPath(new URL(
                            'packages/core/src/index.ts',
                            import.meta.url
                        )),
                    },
                },
            },
            {
                extends: true,
                root: fileURLToPath(new URL('packages/solver', import.meta.url)),
                test: { name: 'solver' },
                resolve: {
                    alias: {
                        '#core': fileURLToPath(new URL('packages/core/src', import.meta.url)),
                        '#solver': fileURLToPath(new URL('packages/solver/src', import.meta.url)),
                        '@neonschedule1/core': fileURLToPath(new URL(
                            'packages/core/src/index.ts',
                            import.meta.url
                        )),
                    },
                },
            },
        ],
    },
});
