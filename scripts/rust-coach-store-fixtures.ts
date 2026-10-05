import {writeFile,mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {PROBLEMS} from '../packages/game-schema/src/index.js'
import {getDb} from '../services/api/src/db/index.js'
import {createThread,appendTurn,rememberHint,setThreadSummary,getThread} from '../services/api/src/coach/threads.js'
process.env.DSA_DB_PATH=join(await mkdtemp(join(tmpdir(),'dsa-node-coach-')),'fixture.sqlite')
const db=getDb();db.prepare('INSERT INTO users VALUES(?,?,?,1,1)').run('alice','alice@example.com','legacy')
const cases=[]
for(const problem of PROBLEMS){const thread=createThread({userId:'alice',gameId:`game-${problem.id}`,problemId:problem.id,now:1})
 appendTurn(thread.id,{id:'turn-1',role:'learner',text:'Which half should I keep?',at:2,approxTokens:8},2)
 appendTurn(thread.id,{id:'turn-2',role:'coach',text:'Compare the visible values.',at:3,approxTokens:7,synthetic:true},3)
 setThreadSummary(thread.id,'An earlier question about comparison.',4);rememberHint(thread.id,'Compare the visible values.',5)
 const expected=getThread(thread.id,6);const row=db.prepare('SELECT data_json FROM coach_history WHERE id=?').get(thread.id) as {data_json:string};cases.push({record:JSON.parse(row.data_json),expected})
}
await writeFile(new URL('../services/api-rust/tests/fixtures/coach-store.json',import.meta.url),JSON.stringify(cases)+'\n');console.log(`Captured ${cases.length} legacy coach records`)
