import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    rollupOptions: {
      // lab.html: tracking lab (rendered test figures + live camera benchmark) for device testing.
      input: { main: 'index.html', lab: 'lab.html' },
      output: {
        // Keep the pose runtime in its own chunk so the camera path never waits on dashboard code.
        manualChunks(id) {
          if (id.includes('@mediapipe/tasks-vision')) return 'pose-runtime';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
