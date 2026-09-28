import { ProblemView } from '@/components/problem/ProblemView'

// `problemId` only reaches the client component, which resolves it from
// /api/catalogue at runtime. Force-dynamic keeps `next build` independent of a
// running API.
export const dynamic = 'force-dynamic'

export default async function ProblemPage({ params }: { params: Promise<{ problemId: string }> }) {
  const { problemId } = await params
  return <ProblemView problemId={problemId} />
}
