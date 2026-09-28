import { DebriefView } from '@/components/debrief/DebriefView'

// The debrief arrives with the final /api/action response and is restored from
// sessionStorage; nothing is fetched at build time.
export const dynamic = 'force-dynamic'

export default async function DebriefPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params
  return <DebriefView gameId={gameId} />
}
