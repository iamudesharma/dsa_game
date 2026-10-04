import { writeFile } from 'node:fs/promises'
import { PROBLEMS } from '../packages/game-schema/src/index.js'
import { tokenize,hashString,scoreProblems,routeProblem,pickTheme,pickHint,tagMisconception,tagMisconceptionDetailed,difficulty } from '../packages/decision-layer/src/heuristics.js'
const cases:any[]=[]
for(const text of ['', 'unknown zzz', 'I want to practise sorting', 'binary-search', 'stacking popped values', 'emoji 😀 and İΣ',...PROBLEMS.flatMap(p=>[p.id,p.title,p.learningObjective])]) {
 for(const allowed of [undefined,[],['binary-search','bubble-sort'],['invalid']])cases.push({kind:'route',text,allowed:allowed??null,tokens:tokenize(text),hash:hashString(text),scores:scoreProblems(text,allowed),result:routeProblem(text,allowed)})
 for(const candidates of [[],['neon','treasure-vault','noir'],['duplicate','duplicate','emoji 😀']])cases.push({kind:'theme',text,candidates,result:pickTheme(candidates,text)})
}
for(const pool of [[],['Inspect the value','Compare the pair','Keep the left half','Commit your answer'],['0','1','2']])for(const used of [-2,0,1.9,2,3,10])for(const op of [undefined,'read','compare','choose-path','swap','invalid'])cases.push({kind:'hint',pool,used,op:op??null,result:pickHint(pool,used,op)})
for(const steps of [-1,0,10,40,400,1000])for(const mistakes of [-1,0,1,3,20])for(const hints of [-1,0,1,4,10])cases.push({kind:'difficulty',steps,mistakes,hints,result:difficulty(steps,mistakes,hints)})
for(const ops of [[],['compare'],['compare','assign'],['traverse','pop','choose-path'],['swap','swap','read','invalid']])for(const correct of [true,false]){const trace=ops.map(dsaOp=>({dsaOp,correct}));cases.push({kind:'tag',trace,result:tagMisconception(trace as any),detailed:tagMisconceptionDetailed(trace as any)})}
await writeFile(new URL('../services/api-rust/tests/fixtures/decisions.json',import.meta.url),JSON.stringify(cases)+'\n')
console.log(`Captured ${cases.length} Node decision fixtures before Rust implementation`)
