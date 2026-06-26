import { requireSession } from '@/lib/auth-helpers'
import { AppHeader } from '@/components/app-header'
import { FeedbackWidget } from '@/components/FeedbackWidget'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession()
  const user = session?.user
  return (
    <>
      <AppHeader />
      <div className="pt-14">{children}</div>
      {user?.id && user?.email && (
        <FeedbackWidget userId={user.id} email={user.email} />
      )}
    </>
  )
}
