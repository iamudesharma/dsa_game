'use client'
import Link from 'next/link'
import type { LearningThread } from '@/lib/learning-api'
export function ConversationList({threads,threadId,query,busy,open,changeQuery,rename,remove}: {threads:LearningThread[];threadId?:string;query:string;busy:boolean;open:boolean;changeQuery:(q:string)=>void;rename:(t:LearningThread)=>void;remove:(t:LearningThread)=>void}) {
 return <div id="chat-conversations" className={`chat-sidebar-body ${open?'is-open':''}`}><input className="input mt-3" aria-label="Search conversations" placeholder="Search conversations" value={query} onChange={e=>changeQuery(e.target.value)}/><ul className="mt-3 space-y-2">{threads.map(t=><li key={t.id} className="panel p-2"><Link href={`/chat/${t.id}`} aria-current={threadId===t.id?'page':undefined} className="block font-medium truncate">{t.title}</Link><div className="flex gap-3 text-xs mt-2"><button disabled={busy} onClick={()=>rename(t)}>Rename</button><button disabled={busy} onClick={()=>remove(t)}>Delete</button></div></li>)}</ul>{!threads.length&&<p className="mt-4 text-sm">{query?'No matching conversations.':'Your conversations will appear here.'}</p>}</div>
}
