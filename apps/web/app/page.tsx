import { HomeView } from '@/components/home/HomeView'

/**
 * The catalogue is fetched in the browser, so this route is dynamic: a build
 * with no API running must still succeed.
 */
export const dynamic = 'force-dynamic'

export default function HomePage() {
  return (
    <div className="min-h-dvh">
      <HomeView />
    </div>
  )
}
