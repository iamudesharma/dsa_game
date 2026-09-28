import { PlayView } from '@/components/play/PlayView'

// A cold `/play/<id>` (pasted link, new tab) is restored from the server in the
// client via `GET /api/game/:id`; sessionStorage covers refresh and back/forward.
// Nothing on this route is resolved at build time.
export const dynamic = 'force-dynamic'

export default async function PlayPage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params
  return <PlayView gameId={gameId} />
}
