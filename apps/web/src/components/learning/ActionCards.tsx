'use client'
import Link from 'next/link'
import { getProblem } from '@dsa/game-schema'
import type { LearningMessage } from '@/lib/learning-api'
export function ActionCards({message,busy,actionBusy,act,cancel}: {message:LearningMessage;busy:boolean;actionBusy:string;act:(i:number,instant?:boolean)=>void;cancel:()=>void}) {
 return <div className="space-y-3 mt-3">{message.actions.map((a,i)=><section className="panel p-3" key={i}><h3 className="font-semibold">{a.type==='game'?getProblem(a.problemId)?.title:a.type==='interview'?'Interview question set':a.title}</h3><p className="text-sm">{a.type==='game'?`${a.difficulty==='easy'?'Low':a.difficulty==='hard'?'High':'Medium'} difficulty · playable practice`:a.type==='interview'?'Uses your saved interview target.':'Save this study plan to Progress.'}</p><div className="flex flex-wrap gap-2 mt-2"><button className="btn btn-primary" disabled={busy||!!actionBusy} onClick={()=>act(i)}>{actionBusy===`${message.id}:${i}`?'Generating…':a.type==='plan'?'Save plan':'Generate and open'}</button>{a.type==='game'&&<button className="btn" disabled={busy||!!actionBusy} onClick={()=>act(i,true)}>Start instant practice</button>}{actionBusy===`${message.id}:${i}`&&<button className="btn" onClick={cancel}>Cancel</button>}{a.type==='interview'&&<Link className="btn" href="/account?tab=target">Edit target</Link>}</div></section>)}</div>
}
