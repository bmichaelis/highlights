import { signIn } from '@/lib/auth'

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <form action={async () => { 'use server'; await signIn('google', { redirectTo: '/' }) }}>
        <button type="submit" className="px-6 py-3 bg-blue-600 text-white rounded-lg">
          Sign in with Google
        </button>
      </form>
    </main>
  )
}
