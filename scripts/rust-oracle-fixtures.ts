/** Oracle-level fixtures; no model calls or runtime JS dependency. */
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { ORACLES } from '../packages/dsa-oracles/src/index.js'
import type { Action } from '../packages/game-schema/src/index.js'
function stable(v:unknown):unknown{if(Array.isArray(v))return v.map(stable);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,v])=>[k,stable(v)]));return v}
function hash(v:unknown){return createHash('sha256').update(JSON.stringify(stable(v))).digest('hex')}
const ids=['climbing-stairs','house-robber','coin-change','jump-game','single-number','subsets','permutations','tree-traversals','tree-level-order','bst-search','bst-validate','sliding-window-max-sum','two-pointers-pair','prefix-sum-range','kadane-max-subarray','merge-intervals','next-greater-element','rotated-search','linked-list-cycle','frequency-count','valid-anagram','valid-palindrome','kth-largest-heap','trie-prefix-search','two-sum','move-zeroes','valid-parentheses','stack-push-pop','queue-operations','linked-list-traversal','reverse-linked-list','num-islands','max-area-island','rotting-oranges','word-search','union-find-connect','network-delay-time','kruskal-mst','unique-paths','lcs-length','edit-distance','array-max-min']
const cases=[]
for(const id of ids)for(let seed=0;seed<30;seed++)for(const difficulty of ['easy','medium','hard'] as const){
  const oracle=ORACLES[id]!;const instance=oracle.buildInstance({seed,difficulty});let state=oracle.initState(instance)
  const canonical=oracle.canonicalTrace(state)
  const initial=hash(state);const moves=[];const metadata=hash({pseudocode:oracle.pseudocode(),complexity:oracle.complexity(),code:Object.fromEntries(['javascript','typescript','python','java','cpp'].map(language=>[language,oracle.code(language as any)]))})
  for(const [i,frame]of canonical.entries()){
    const checks=[]
    for(const invalid of [{type:'submitAnswer',targetId:'missing',value:'-1'},{type:'assignValue',targetId:'dp_0',value:'wrong'}] as Action[]){const r=oracle.applyAction(state,invalid);checks.push({action:invalid,result:hash(r)})}
    const action={...frame.action,...(i%2===0?{actionId:`request-${i}`}:{})}
    const legal=hash(oracle.legalActions!(state));const r=oracle.applyAction(state,action);moves.push({action,legal,result:hash(r),checks});state=r.nextState
  }
  cases.push({id,seed,difficulty,initial,metadata,moves,canonical:hash(canonical),answer:hash(oracle.answerSummary(state)),terminal:hash(oracle.applyAction(state,{type:'selectObject',objectId:'v0'})),terminalLegal:hash(oracle.legalActions!(state))})
}
const output=new URL('../services/api-rust/tests/fixtures/oracles.json',import.meta.url)
const encoded=JSON.stringify(cases)+'\n'
if(process.argv.includes('--check')){if(await readFile(output,'utf8')!==encoded)throw new Error('Rust oracles reference fixtures drifted')}else await writeFile(output,encoded)
console.log(`Captured ${cases.length} complete oracle journeys with invalid actions`)
