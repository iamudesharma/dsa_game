/** Offline Node reference: no provider requests or local model processes. */
import {writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {PROBLEMS} from '../packages/game-schema/src/index.js'
import {ORACLES} from '../packages/dsa-oracles/src/index.js'
import {LocalLlmProvider,salvageSpec} from '../packages/provider-chain/src/providers/local-llm.js'
function stable(v:any):any {if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')
const partials=[null,{}, {theme:{title:'Remote garden',genre:'unknown',tone:'wrong'}},
 {theme:{title:'Remote garden'},narration:{intro:'Begin carefully.',hintPool:[]}},
 {theme:{title:'Remote garden'},narration:{hintPool:Array(9).fill('too many')}},
 {objective:''}, {vocabulary:{objectNoun:'leaf',badField:3}},
 {visual:{palette:{background:'wrong'},objectGlyphs:{leaf:'🌿'}}},
 {debrief:{summary:'A small invariant.',mapping:[],actionMeaning:{selectObject:'inspect'}}},
 {theme:{title:'  ',story:'A remote story.'},narration:{intro:'  '}},
 {theme:{title:'Remote garden'},visual:{objectGlyphs:{leaf:123}}}]
const cases=[]
for(const problem of PROBLEMS)for(const difficulty of ['easy','medium','hard'] as const){
 const input={problem,instance:ORACLES[problem.id]!.buildInstance({seed:7,difficulty}),seed:7,difficulty,language:'en' as const}
 const provider=new LocalLlmProvider({enabled:true,model:'local-model',temperature:0.7,maxTokens:2000})
 const modes=(provider as any).responseFormats(input).map((m:any)=>m.body)
 cases.push({input,modes:hash(modes),salvage:partials.map(partial=>({partial,hash:hash(salvageSpec(partial,input))}))})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/local-provider.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} mode cases and ${cases.length*partials.length} salvage cases`)
