'use client'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Markdown as MessageMarkdown } from './Markdown'
import { ChatComposer } from './ChatComposer'
import { ContextSelector } from './ContextSelector'
import { ConversationList } from './ConversationList'
import { ActionCards } from './ActionCards'
import { ChatContextSchema } from '@dsa/account'
import { useAuth } from '@/components/auth/AuthProvider'
import { useGameStore } from '@/store/game'
import {
  learningRequest,
  allMessages,
  streamLearning,
  requestId,
  type LearningThread,
  type LearningMessage,
  type ChatContext,
} from '@/lib/learning-api'
import type { GenerateResponse } from '@dsa/game-schema'
import { getProblem } from '@dsa/game-schema'

export function ChatView({ threadId }: { threadId?: string }) {
  const router = useRouter(),
    { user } = useAuth()
  const searchParams = useSearchParams()
  const requestedPrompt = searchParams.get('prompt')
  const requestedReference = searchParams.get('reference')
  const [threads, setThreads] = useState<LearningThread[]>([]),
    [messages, setMessages] = useState<LearningMessage[]>([]),
    [query, setQuery] = useState(''),
    [draft, setDraft] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [partial, setPartial] = useState(''),
    [context, setContext] = useState<ChatContext>({ history: true, resume: false, target: false }),
    [atBottom, setAtBottom] = useState(true),
    [actionBusy, setActionBusy] = useState('')
  const [nextThreads,setNextThreads] = useState<string|null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const creation = useRef(false)
  const pendingSend = useRef<{ text: string; id: string } | null>(null)
  const [dialog, setDialog] = useState<{ thread: LearningThread; mode: 'rename' | 'delete' } | null>(null)
  const [title, setTitle] = useState('')
  const visibleThread = useRef(threadId)
  visibleThread.current = threadId
  const draftRef = useRef(draft)
  draftRef.current = draft
  const actionController = useRef<AbortController | null>(null)
  const controller = useRef<AbortController | null>(null),
    end = useRef<HTMLDivElement>(null),
    log = useRef<HTMLDivElement>(null)
  const hydrate = useGameStore((s) => s.hydrateFromGenerate)
  const key = `dsa-chat-draft:${user?.id}:${threadId ?? 'new'}`
  const refresh = () =>
    learningRequest<{ threads: LearningThread[]; nextCursor: string|null }>(`/threads?q=${encodeURIComponent(query)}`).then((d) =>
      { setThreads(d.threads);setNextThreads(d.nextCursor) },
    )
  useEffect(() => {
    let alive = true
    const timer = setTimeout(() => {
      learningRequest<{ threads: LearningThread[]; nextCursor: string|null }>(`/threads?q=${encodeURIComponent(query)}`)
        .then((d) => {
          if (alive) { setThreads(d.threads);setNextThreads(d.nextCursor) }
        })
        .catch((e) => {
          if (alive) setError(e.message)
        })
    }, 200)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [user?.id, query])
  useEffect(() => {
    let alive = true
    setMessages([])
    setError('')
    setPartial('')
    setStatus('')
    setBusy(false)
    setLoaded(!threadId)
    try {
      const saved = localStorage.getItem(`dsa-chat-context:${user?.id}:${threadId ?? 'new'}`)
      const reference = requestedReference
      setContext(ChatContextSchema.parse({ ...(saved ? JSON.parse(saved) : { history: true, resume: false, target: false }), ...(reference ? { reference: JSON.parse(reference) } : {}) }))
    } catch {
      setContext({ history: true, resume: false, target: false })
    }
    try {
      setDraft(requestedPrompt ?? localStorage.getItem(key) ?? '')
    } catch {
      setDraft(requestedPrompt ?? '')
    }
    if (threadId)
      allMessages(threadId)
        .then((d) => {
          if (alive) {
            setMessages(d.messages)
            let hasSavedContext=false;try { hasSavedContext=!!localStorage.getItem(`dsa-chat-context:${user?.id}:${threadId}`) } catch {}
            if (!hasSavedContext) {
              const last=d.messages.filter(m=>m.role==='user').at(-1); if(last?.context) setContext(last.context)
            }
            setLoaded(true)
          }
        })
        .catch((e) => {
          if (alive) setError(e.message)
        })
    return () => {
      alive = false
      controller.current?.abort()
      actionController.current?.abort()
    }
  }, [threadId, user?.id, key, requestedPrompt, requestedReference])
  useEffect(() => {
    if (atBottom) end.current?.scrollIntoView({ block: 'nearest' })
  }, [messages, partial, atBottom])
  const changeDraft = (value: string) => {
    draftRef.current = value
    setDraft(value)
    try {
      localStorage.setItem(key, value)
    } catch {}
  }
  const newChat = async () => {
    try {
      const d = await learningRequest<{ thread: LearningThread }>('/threads', { method: 'POST' })
      router.push(`/chat/${d.thread.id}`)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const send = async (text = draft, regenerate = false) => {
    if (busy || !text.trim()) return
    if (!threadId) {
      if (creation.current) return
      creation.current = true
      try {
        const d = await learningRequest<{ thread: LearningThread }>('/threads', { method: 'POST' })
        localStorage.setItem(`dsa-chat-draft:${user?.id}:${d.thread.id}`, text)
        localStorage.setItem(`dsa-chat-context:${user?.id}:${d.thread.id}`, JSON.stringify(context))
        changeDraft('')
        router.push(`/chat/${d.thread.id}?send=1`)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        creation.current = false
      }
      return
    }
    setBusy(true)
    setError('')
    setPartial('')
    setStatus('Sending…')
    const ac = new AbortController()
    controller.current = ac
    const rid = pendingSend.current?.text === text && !regenerate ? pendingSend.current.id : requestId()
    if (!regenerate) pendingSend.current = { text, id: rid }
    const optimistic: LearningMessage = {
      id: rid,
      requestId: rid,
      role: 'user',
      text,
      status: 'complete',
      createdAt: Date.now(),
      actions: [],
      sources: [],
    }
    if (!regenerate) setMessages((ms) => [...ms.filter(m=>m.id!==rid), optimistic])
    if (!regenerate) changeDraft('')
    setAtBottom(true)
    try {
      await streamLearning(threadId, { text, requestId: rid, context, regenerate }, ac.signal, (event) => {
        if (visibleThread.current !== threadId) return
        if (event.type === 'text') setPartial((p) => p + event.text)
        if (event.type === 'status') setStatus(event.message)
        if (event.type === 'error') setError(event.message)
        if (event.type === 'complete') {
          setPartial('')
          pendingSend.current = null
          setMessages((ms) => [...ms.filter((m) => m.id !== event.message.id), event.message])
        }
      })
    } catch (e) {
      if (!ac.signal.aborted) {
        setError((e as Error).message)
        if (!draftRef.current.trim() && !regenerate) changeDraft(text)
      }
    } finally {
      if (visibleThread.current !== threadId) return
      setBusy(false)
      setStatus('')
      controller.current = null
      allMessages(threadId)
        .then((d) => {
          if (visibleThread.current !== threadId) return
          setMessages(d.messages)
          setPartial('')
        })
        .catch(() => {})
      void refresh().catch(() => {})
    }
  }
  const autoSent = useRef<string | null>(null)
  useEffect(() => {
    if (
      threadId &&
      loaded &&
      draft &&
      !busy &&
      autoSent.current !== threadId &&
      new URLSearchParams(window.location.search).get('send') === '1'
    ) {
      autoSent.current = threadId
      router.replace(`/chat/${threadId}`)
      void send(draft)
    }
  }, [threadId, draft, loaded])
  const stop = () => {
    if (threadId) void learningRequest(`/threads/${threadId}/cancel`, { method: 'POST' }).catch(() => {})
    controller.current?.abort()
  }
  const rename = (t: LearningThread) => { setTitle(t.title); setDialog({ thread: t, mode: 'rename' }) }
  const remove = (t: LearningThread) => setDialog({ thread: t, mode: 'delete' })
  const submitDialog = async () => {
    if (!dialog) return
    try {
      await learningRequest(`/threads/${dialog.thread.id}`, { method: dialog.mode === 'delete' ? 'DELETE' : 'PUT', ...(dialog.mode === 'rename' ? { body: JSON.stringify({title}) } : {}) })
      if (dialog.mode === 'delete' && dialog.thread.id === threadId) router.push('/chat')
      setDialog(null); await refresh()
    } catch (e) { setError((e as Error).message) }
  }
  const act = async (m: LearningMessage, index: number, forceTemplate = false) => {
    actionController.current?.abort()
    const ac = new AbortController()
    actionController.current = ac
    const action = m.actions[index]!,
      id = `${m.id}:${index}`
    setActionBusy(id)
    setError('')
    try {
      const result = await learningRequest<GenerateResponse & { saved?: boolean; kitId?: string }>(
        `/threads/${threadId}/actions`,
        {
          method: 'POST',
          body: JSON.stringify({
            messageId: m.id,
            index,
            requestId: `action-${m.id}-${index}`,
            forceTemplate,
          }),
          signal: ac.signal,
        },
      )
      if (ac.signal.aborted) return
      if (action.type === 'game') {
        hydrate({
          ...result,
          intent: { problemId: action.problemId, difficulty: action.difficulty, seed: result.seed, forceTemplate },
        })
        router.push(`/play/${result.gameId}?chat=${threadId}`)
      } else if (action.type === 'interview') router.push(`/account?tab=interview&kit=${result.kitId}`)
      else setStatus('Study plan saved to your Dashboard.')
    } catch (e) {
      if (!ac.signal.aborted) setError((e as Error).message)
    } finally {
      if (actionController.current === ac) {
        setActionBusy('')
        actionController.current = null
      }
    }
  }
  const latestUser = messages.filter((m) => m.role === 'user').at(-1)
  return (
    <main className="chat-workspace mx-auto max-w-7xl px-3 py-5">
      <aside className="panel p-4 chat-sidebar">
        <div className="flex justify-between items-center gap-2">
          <h2 className="font-bold">Conversations</h2>
          <button className="btn" disabled={busy} onClick={() => void newChat()}>
            New chat
          </button>
        </div>
        <button
          className="btn mt-3 chat-sidebar-toggle"
          aria-expanded={sidebarOpen}
          aria-controls="chat-conversations"
          onClick={() => setSidebarOpen((v) => !v)}
        >
          {sidebarOpen ? 'Hide conversations' : 'Browse conversations'}
        </button>
        <ConversationList threads={threads} threadId={threadId} query={query} busy={busy} open={sidebarOpen} changeQuery={setQuery} rename={rename} remove={remove} />
        {nextThreads && <button className="btn mt-2" onClick={() => { void learningRequest<{threads:LearningThread[];nextCursor:string|null}>(`/threads?q=${encodeURIComponent(query)}&cursor=${encodeURIComponent(nextThreads)}`).then(d=>{setThreads(t=>[...t,...d.threads]);setNextThreads(d.nextCursor)}).catch(e=>setError(e.message)) }}>Load more conversations</button>}
      </aside>
      <section className="panel chat-main p-4">
        <header>
          <p className="eyebrow">YOUR DSA & CAREER TUTOR</p>
          <h1 className="text-2xl font-bold">Let’s work through it</h1>
          <p className="text-sm mt-1">
            Ask for explanations, code, interview questions, or a study plan. Generated answers are not
            oracle-verified.
          </p>
        </header>
        <ContextSelector context={context} busy={busy} change={next => { setContext(next); try { localStorage.setItem(`dsa-chat-context:${user?.id}:${threadId ?? 'new'}`,JSON.stringify(next)) } catch {} }} />
        <div
          ref={log}
          className="chat-transcript"
          onScroll={() => {
            const el = log.current
            if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
          }}
        >
          {!loaded && threadId && <p role="status">Loading this conversation…</p>}
          {!messages.length && !busy && loaded && (
            <div className="space-y-3 py-6">
              <p>What would you like to explore?</p>
              {[
                'Explain sliding windows with an example and code.',
                'Review my practice. What should I study next?',
                'Prepare me for a backend interview.',
                'Create a 7-day DSA study plan.',
              ].map((p) => (
                <button key={p} className="btn block" onClick={() => changeDraft(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
          {messages.map((m) => (
            <article key={m.id} className={`chat-message ${m.role === 'user' ? 'chat-user' : ''}`}>
              <p className="eyebrow">
                {m.role === 'user' ? 'YOU' : 'TUTOR'}
                {m.status !== 'complete' ? ` · ${m.status}` : ''}
              </p>
              <MessageMarkdown text={m.text} />
              {m.role === 'assistant' && (
                <>
                  <ActionCards message={m} busy={busy} actionBusy={actionBusy} act={(i,instant) => void act(m,i,instant)} cancel={() => actionController.current?.abort()} />
                  <button className="btn text-xs mt-2" onClick={() => void navigator.clipboard.writeText(m.text).catch(() => setError('Copy failed. Select the text to copy it.'))}>Copy answer</button>
                  {m.sources.length > 0 && (
                    <details className="mt-2 text-sm">
                      <summary>Practice and profile evidence used</summary>
                      <ul>
                        {m.sources.map((s, i) => (
                          <li key={i}>
                            <Link className="underline" href={s.href}>
                              {s.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              )}
            </article>
          ))}
          {busy && (
            <article className="chat-message">
              <p className="eyebrow">TUTOR · RESPONDING</p>
              <MessageMarkdown text={partial} />
            </article>
          )}
          <div ref={end} />
        </div>
        {!atBottom && (
          <button
            className="btn"
            onClick={() => {
              setAtBottom(true)
              end.current?.scrollIntoView({ block: 'nearest' })
            }}
          >
            Jump to latest ↓
          </button>
        )}
        <div className="sr-only" role="log" aria-live="polite" aria-relevant="additions text">
          {messages.filter((m) => m.role === 'assistant').at(-1)?.text}
        </div>
        {error && (
          <p role="alert" className="text-[var(--dsa-danger)] mt-2">
            {error}{' '}
            {/session expired|sign in/i.test(error) && (
              <Link
                className="underline"
                href={`/login?next=${encodeURIComponent(threadId ? `/chat/${threadId}` : '/chat')}`}
              >
                Sign in again
              </Link>
            )}
          </p>
        )}
        <p role="status" className="text-sm min-h-6 mt-2">
          {status}
        </p>
        <ChatComposer draft={draft} busy={busy} loaded={loaded} changeDraft={changeDraft} send={() => void send()} stop={stop} />
        {latestUser && !busy && <button className="btn mt-2" onClick={() => void send(latestUser.text,true)}>{messages.at(-1)?.status === 'failed' || messages.at(-1)?.status === 'interrupted' ? 'Retry last question' : 'Regenerate'}</button>}
        {dialog && <dialog open aria-labelledby="conversation-dialog-title" ref={el => { if (el && !el.matches(':modal')) { el.close(); el.showModal() } }} onCancel={() => setDialog(null)} className="panel p-5"><form onSubmit={e => { e.preventDefault(); void submitDialog() }}><h2 id="conversation-dialog-title" className="font-bold">{dialog.mode === 'rename' ? 'Rename conversation' : 'Delete conversation?'}</h2>{dialog.mode === 'rename' ? <label>Title<input autoFocus className="input mt-3" value={title} maxLength={160} onChange={e => setTitle(e.target.value)} /></label> : <p>This removes “{dialog.thread.title}” and its messages.</p>}<div className="flex gap-3 mt-4"><button type="button" autoFocus={dialog.mode === 'delete'} className="btn" onClick={() => setDialog(null)}>Cancel</button><button className="btn" disabled={dialog.mode === 'rename' && !title.trim()}>{dialog.mode === 'rename' ? 'Save title' : 'Delete'}</button></div></form></dialog>}

      </section>
    </main>
  )
}