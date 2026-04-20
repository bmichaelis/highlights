import { vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

vi.mock('@/lib/auth.config', () => ({
  auth: vi.fn(),
}))

vi.mock('@/db', () => ({
  getDb: vi.fn(),
}))
