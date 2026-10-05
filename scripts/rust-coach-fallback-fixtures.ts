import {writeFile} from 'node:fs/promises'
import {PROBLEMS} from '../packages/game-schema/src/index.js'
import {ORACLES} from '../packages/dsa-oracles/src/index.js'
import {createGameRuntime} from '../packages/game-engine/src/index.js'
import {deriveTurnPrompt} from '../packages/game-engine/src/guidance.js'
import {buildTemplateSpec} from '../packages/provider-chain/src/providers/template.js'
import {buildSnapshot} from '../services/api/src/coach/snapshot.js'
import {classifyIntent,fallbackAnswer} from '../services/api/src/coach/fallback.js'
const cases:any[]=[];const questions=['which half, left or right?','which value should I compare?','why was that wrong?','help me please','hello!']
for(const problem of PROBLEMS)for(const difficulty of ['easy','medium','hard'] as const){
 const oracle=ORACLES[problem.id]!,runtime=createGameRuntime(oracle);let state=runtime.init(7,difficulty);const spec=buildTemplateSpec({problem,instance:state.instance,seed:7,difficulty,language:'en'});const frames=oracle.canonicalTrace(state)
 const states=[state];if(frames[0])states.push(runtime.apply(state,frames[0].action).state);for(const f of frames)state=runtime.apply(state,f.action).state;states.push(state)
 for(const state of states){const turnPrompt=deriveTurnPrompt({state,spec,oracle});const snapshot=buildSnapshot({state,spec,oracle,turnPrompt});
 for(const question of questions)for(const band of ['newcomer','builder'] as const){const input={question,snapshot,turnPrompt,band};const expected=fallbackAnswer(input);cases.push({...input,givenHints:[],expected});const givenHints=[expected.text];cases.push({...input,givenHints,expected:fallbackAnswer({...input,givenHints})})}}
}
const classified=[...questions,'left or right, which one?','what now?','okay thanks','unrelated words','how do i play?','go left','it said wrong','what happened?','what value?','next?','what is this?','which\u00a0half?'].map(question=>({question,expected:classifyIntent(question)}))
await writeFile(new URL('../services/api-rust/tests/fixtures/coach-fallback.json',import.meta.url),JSON.stringify({cases,classified})+'\n');console.log(`Captured ${cases.length} fallback cases`)
