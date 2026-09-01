import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    // Только чистая логика: тесты не поднимают базу и не ходят в сеть, поэтому
    // файлы рядом с модулями, а не в отдельном каталоге.
    include: ['lib/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': resolve(__dirname) },
  },
});
