import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import { createGameRuntime, nextHint, incrementHintsUsed, rewindProgressTo } from '../packages/game-engine/src/index.js'
const texts = ['Think about which values remain.', 'mid=3', 'mid\u00a0=3', 'mid\u0085=3', 'answer\ufeffis 5', 'The answer is 5', 'Choose index 2', 'Well done!', '```js\nreturn 2;\n```', 'const x = 1;\nreturn x;', 'return left;', 'after each comparison, move the bound just past the probed element, then repeat', 'take the fifth one', 'lo>hi', '\ufeffInspect the remaining values.\ufeff', '', 'If the value is higher, narrow the range.']
function stable(v:any):any{if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
function hash(v:any){return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}
const cases=[]
for(const [id, oracle] of Object.entries(ORACLES)) for(const difficulty of ['easy','medium','hard'] as const){
 const runtime=createGameRuntime(oracle);let state=runtime.init(7,difficulty);const moves=[]
 for(const action of oracle.canonicalTrace(state).map(f=>f.action)){
  const checks=[{spec:null,preferred:null,result:hash(nextHint(state,oracle))}]
  for(const text of texts){const spec={narration:{hintPool:[text]}} as any;checks.push({spec,preferred:0,result:hash(nextHint(state,oracle,spec,{preferIndex:0}))})}
  const next=runtime.apply(state,action).state
  moves.push({action,checks,increment:hash(incrementHintsUsed(state)),undo:hash(rewindProgressTo(next,state))})
  state=next
 }
 cases.push({id,difficulty,moves})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/hints.json',import.meta.url), JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} hint and undo journeys across ${cases.reduce((sum, c) => sum + c.moves.length, 0)} played states`)
