import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        alias: {
            '#core': fileURLToPath(new URL('../core/src', import.meta.url)),
            '#solver': fileURLToPath(new URL('./src', import.meta.url)),
            '@neonschedule1/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
        },
    },
});
