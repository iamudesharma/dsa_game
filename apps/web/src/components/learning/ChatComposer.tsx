'use client'
import { useEffect, useRef } from 'react'
export function ChatComposer({ draft, busy, loaded, changeDraft, send, stop }: { draft: string; busy: boolean; loaded: boolean; changeDraft: (s: string) => void; send: () => void; stop: () => void }) {
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(220,Math.max(56,el.scrollHeight))}px` } }, [draft])
  return <form className="chat-composer" onSubmit={e => { e.preventDefault(); send() }}><label className="sr-only" htmlFor="chat-input">Your message</label><textarea ref={input} id="chat-input" className="input" value={draft} maxLength={8000} placeholder="Ask about DSA, your practice, or interview preparation…" onChange={e => changeDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!busy && loaded) send() } }} /><div className="flex justify-between items-center mt-2"><span className="text-xs">Enter to send · Shift+Enter for a new line</span>{busy ? <button type="button" className="btn" onClick={stop}>Stop response</button> : <button className="btn btn-primary" disabled={!loaded || !draft.trim()}>Send</button>}</div></form>
}
