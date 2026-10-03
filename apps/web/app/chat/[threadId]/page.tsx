import { LearningGate } from '@/components/learning/LearningGate'
import { ChatView } from '@/components/learning/ChatView'
export default async function Page({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = await params
  return (
    <LearningGate>
      <ChatView threadId={threadId} />
    </LearningGate>
  )
}
