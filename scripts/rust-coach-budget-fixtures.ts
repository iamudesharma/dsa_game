import { writeFile } from 'node:fs/promises'
import { assembleWindow, budgetAfterPreamble, estimateTokens } from '../services/api/src/coach/budget.js'
const cases:any[]=[]
for(const size of [0,1,2,24,25,70])for(const maxPromptTokens of [0,1,6,7,20,100,6000])for(const snapshot of [false,true]){
 const turns=Array.from({length:size},(_,i)=>({id:`turn-${i}`,role:i%2?'coach':'learner',text:i%3?'An older sentence. Here is the next sentence! 🙂 This continues for a long time. '.repeat(i%5+1):'x'.repeat(150),createdAt:i,...(snapshot?{snapshot:{board:Array.from({length:16},(_,i)=>({label:`cell ${i}`,value:i})),goal:'Learn the algorithm'}}:{})}))
 const budget={maxPromptTokens,replyReserveTokens:0,maxTurns:24};const prior='A previous summary\n'+'old line\n'.repeat(15)
 cases.push({turns,budget,prior,expected:assembleWindow(turns as any,budget,prior)})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/coach-budget.json',import.meta.url),JSON.stringify({cases,estimates:['','🙂','abc','abcdefghi'].map(text=>({text,expected:estimateTokens(text)})),preamble:budgetAfterPreamble(['a'.repeat(30000)])})+'\n')
console.log(`Captured ${cases.length} coach budget cases`)
