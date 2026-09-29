import { ProblemView } from '@/components/problem/ProblemView'
import type { Difficulty } from '@dsa/game-schema'

// `problemId` only reaches the client component, which resolves it from
// /api/catalogue at runtime. Force-dynamic keeps `next build` independent of a
// running API.
export const dynamic = 'force-dynamic'

export default async function ProblemPage({
  params,
  searchParams,
}: {
  params: Promise<{ problemId: string }>
  searchParams: Promise<{ question?: string | string[]; difficulty?: string | string[] }>
}) {
  const [route, query] = await Promise.all([params, searchParams])
  const questionId = typeof query.question === 'string' ? query.question : undefined
  const requestedDifficulty = typeof query.difficulty === 'string' ? query.difficulty : undefined
  const initialDifficulty: Difficulty | undefined =
    requestedDifficulty === 'easy' || requestedDifficulty === 'medium' || requestedDifficulty === 'hard'
      ? requestedDifficulty
      : undefined
  return <ProblemView problemId={route.problemId} questionId={questionId} initialDifficulty={initialDifficulty} />
}
