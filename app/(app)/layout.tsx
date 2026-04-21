import { requireSession } from '@/lib/auth-helpers'
import { AppHeader } from '@/components/app-header'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireSession()
  return (
    <>
      <AppHeader />
      <div className="pt-14">{children}</div>
    </>
  )
}
