import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    // After running `wrangler dev` once, find the actual path with:
    // ls .wrangler/state/v3/d1/miniflare-D1DatabaseObject/
    // Then update this url to match (it will be a hash filename, not DB.sqlite)
    url: '.wrangler/state/v3/d1/miniflare-D1DatabaseObject/DB.sqlite',
  },
})
