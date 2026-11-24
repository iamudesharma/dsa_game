import {writeFile} from 'node:fs/promises'
import {screenCoachReply,findViolation} from '../services/api/src/coach/guardrails.js'
const replies=['',' Hi there ','```python\nreturn 5\n```','let x=5;\nreturn x;','There is a return x; here.','The answer is 5','It is the answer 7','5 is the answer','It is the 51 stone','51 is the target','submit index 5','The fifth slot is the goal','The window between index 2 and index 5 remains in play','Go with 5','answer me with just 5','Click the middle, then choose right','Click the middle. Then choose right','Select the value → submit it','Next you will halve the range','After that, you will have it','Then it becomes clear','Eventually the result arrives','That is correct','You found it','Congratulations!','Read the middle value','\ufeffHello\ufeff','\u0085Hello\u0085','return\u00a0x;','It is the\u00a051 stone','Answer\u00a0is\u00a05','Click the middle!\u00a0Then choose right']
const cases=[]
for(const phase of ['playing','won','lost'])for(const total of [0,1,8,25])for(const eliminated of [0,1,8,30])for(const instruction of ['Read the middle','Choose index 5','Submit the answer, then click again'])for(const targetLabel of ['pressure hull','the 51 vault','index 5 goal','a target','vault\tlabel','vault\nlabel','the\ufeff51 vault']){
 const snapshot={phase,board:Array.from({length:total},()=>({label:'value',value:5})),eliminated:Array.from({length:eliminated},(_,i)=>i),instruction,targetLabel,targetValue:51}
 for(const reply of replies)cases.push({reply,snapshot,screen:screenCoachReply(reply,snapshot),violation:findViolation(reply,snapshot)})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/coach-guardrails.json',import.meta.url),JSON.stringify(cases)+'\n');console.log(`Captured ${cases.length} guardrail cases`)
