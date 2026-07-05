import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: true,
    lib: {
      entry: {
        index: 'src/sdk/index.ts',
        admin: 'src/sdk/admin/index.ts',
        host: 'src/sdk/host/index.ts',
        'tunnel-agent': 'src/sdk/tunnel-agent/index.ts',
        transport: 'src/sdk/transport.ts',
        worker: 'src/worker/index.ts',
        tb: 'src/worker/tb/types.ts',
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: ['jose'],
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
      },
    },
  },
});
