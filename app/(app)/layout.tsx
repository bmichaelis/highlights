import { requireSession } from '@/lib/auth-helpers'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return <>{children}</>
}
