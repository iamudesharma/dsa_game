'use client'
import Link from 'next/link'
import { TOPIC_LESSONS, PROBLEMS } from '@dsa/game-schema'
import { Markdown } from '@/components/learning/Markdown'
import { chatLink } from '@/lib/learning-api'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/auth/AuthProvider'
function LearnViewContent() {
 const [query,setQuery]=useState(''),[drafts,setDrafts]=useState<Record<string,string>>({})
 const { user }=useAuth(); const key=`dsa-notebook:${user?.id ?? 'guest'}`
 useEffect(()=>{try{setDrafts(JSON.parse(localStorage.getItem(key)??'{}'))}catch{setDrafts({})}},[key])
 return <main className="mx-auto max-w-5xl p-5 space-y-5"><header><p className="eyebrow">LEARN, TRY, EXPLAIN</p><h1 className="text-3xl font-bold">Your field notebook</h1><p>Choose a foundation, work through an example, then try it yourself.</p></header><nav className="flex flex-wrap gap-3" aria-label="Learning resources"><Link className="btn" href="/patterns">Patterns</Link><Link className="btn" href="/tracks">Interview tracks</Link><Link className="btn" href="/learn/linked-list">Linked-list lab</Link></nav><label className="block">Find a concept<input className="input" value={query} onChange={e=>setQuery(e.target.value)}/></label>{TOPIC_LESSONS.filter(l=>`${l.title} ${l.topic}`.toLowerCase().includes(query.toLowerCase())).map(l=><details className="adventure-drawer" key={l.topic} id={l.topic}><summary>{l.title}</summary><div className="p-4 space-y-3"><p>{l.concept}</p><p><strong>Worked example: </strong>{l.example}</p><Markdown text={'```python\n'+l.code+'\n```'}/><label className="block">Your explanation<textarea className="input" value={drafts[l.topic]??''} onChange={e=>{const next={...drafts,[l.topic]:e.target.value};setDrafts(next);try{localStorage.setItem(key,JSON.stringify(next))}catch{}}}/></label><p className="text-xs">Draft saved on this device when storage is available.</p><div className="flex flex-wrap gap-2"><Link className="btn" href={chatLink(`Explain ${l.title}. Give me a worked example and ask me a practice question.`)}>Discuss in Chat</Link>{PROBLEMS.filter(p=>p.topic===l.topic).map(p=><Link className="btn" href={`/problem/${p.id}`} key={p.id}>{p.title} →</Link>)}</div></div></details>)}</main>
}

export function LearnView() { const {user,ready}=useAuth(); return ready ? <LearnViewContent key={user?.id ?? 'guest'} /> : <p role="status">Loading your notebook…</p> }
