import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['lib/**/*.test.ts'], environment: 'node' },
      },
      {
        extends: true,
        test: { name: 'component', include: ['components/**/*.test.tsx'], environment: 'happy-dom' },
      },
    ],
  },
})
