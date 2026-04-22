import Link from 'next/link'
import { auth } from '@/lib/auth'
import { UserMenu } from './user-menu'

export async function AppHeader() {
  const session = await auth()
  return (
    <header className="fixed top-0 inset-x-0 h-14 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-6 z-40">
      <Link href="/" className="text-white font-bold text-lg">
        Highlights
      </Link>
      {session?.user && (
        <UserMenu name={session.user.name} image={session.user.image} />
      )}
    </header>
  )
}
