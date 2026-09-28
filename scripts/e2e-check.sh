#!/usr/bin/env bash
# End-to-end check of the guidance + coach surface against the live API.
set -uo pipefail
B=http://127.0.0.1:8787
J() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(eval('(j=>('+process.argv[1]+'))')(JSON.parse(s)))}catch(e){console.log('ERR: '+e.message)}})"; }

echo "=== 1. GENERATE (template tier = fast) ==="
curl -s -X POST $B/api/generate -H 'content-type: application/json' \
  -d '{"problemId":"binary-search","seed":4242,"forceTemplate":true}' > /tmp/e2e.json
GID=$(node -e "console.log(require('/tmp/e2e.json').gameId)")
node -e "const j=require('/tmp/e2e.json');
console.log('  gameId  :', j.gameId);
console.log('  theme   :', j.spec.theme.title, '|', j.spec.theme.genre);
console.log('  vocab   :', j.spec.vocabulary.object, '/', j.spec.vocabulary.target);
const p=j.turnPrompt;
console.log('  --- turnPrompt on the OPENING board ---');
console.log('  goal    :', p.goal);
console.log('  DO      :', p.instruction);
console.log('  WHY     :', p.reason);
console.log('  op      :', p.mechanic, '->', p.dsaOp);
console.log('  targets :', p.targets.map(t=>t.label+' ['+t.role+']').join(' | '));
console.log('  left    :', p.indicator.detail, '('+Math.round(p.progress*100)+'%)');
"

echo
echo "=== 2. ONE CORRECT ACTION (guidance + explanatory feedback) ==="
MID=$(node -e "console.log(require('/tmp/e2e.json').state.variables.mid)")
curl -s -X POST $B/api/action -H 'content-type: application/json' \
  -d "{\"gameId\":\"$GID\",\"action\":{\"type\":\"selectObject\",\"objectId\":\"v$MID\"}}" > /tmp/act.json
node -e "const j=require('/tmp/act.json');
const f=j.feedback, p=j.turnPrompt;
console.log('  verdict :', f.verdict);
console.log('  SAY     :', f.headline);
console.log('  TEACH   :', f.teach);
console.log('  didWhat :', f.didWhat);
console.log('  code    : L'+f.codeLine, f.codeLineText.trim());
console.log('  --- next turnPrompt ---');
console.log('  DO      :', p.instruction);
console.log('  targets :', p.targets.map(t=>t.label+' ['+t.role+']').join(' | '));
console.log('  left    :', p.indicator.detail);
"

echo
echo "=== 3. A DELIBERATELY WRONG COMPARISON ==="
node -e "
const fs=require('fs');
const env=JSON.parse(fs.readFileSync('/tmp/act.json','utf8'));
const st=env.state;
const mid=Number(st.variables.mid);
const v=st.instance.values[mid], t=st.instance.target;
const rel = v<t ? 'lt' : 'gt';
// gameId is on the response envelope, not inside state
fs.writeFileSync('/tmp/wrong.json', JSON.stringify({gameId: env.gameId, action:{type:'comparePair',aId:'v'+mid,bId:'target',relation:rel}}));
"
curl -s -X POST $B/api/action -H 'content-type: application/json' -d @/tmp/wrong.json > /tmp/wrong-res.json
node -e "const j=require('/tmp/wrong-res.json'); const f=j.feedback;
console.log('  verdict :', f.verdict);
console.log('  SAY     :', f.headline);
console.log('  TEACH   :', f.teach);
console.log('  NEXT    :', f.nextStep ?? '(none)');
console.log('  nudge   :', j.turnPrompt.nudge ? '['+j.turnPrompt.nudge.tone+'] '+j.turnPrompt.nudge.message : '(none)');
"

echo
echo "=== 4. COACH, turn 1 ==="
curl -s -X POST $B/api/coach/ask -H 'content-type: application/json' \
  -d "{\"gameId\":\"$GID\",\"message\":\"why do I only look at the middle one?\",\"band\":\"explorer\"}" > /tmp/c1.json
node -e "const j=require('/tmp/c1.json');
if (j.error) { console.log('  ERROR:', j.error.code, j.error.message); process.exit(0) }
console.log('  source   :', j.source, j.model ? '('+j.model+')' : '', j.latencyMs+'ms');
console.log('  reply    :', j.reply);
console.log('  redacted :', j.redacted ? j.redacted.reason : 'no');
console.log('  threads  :', j.threads.length, '| turnPrompt DO:', j.turnPrompt.instruction);
require('fs').writeFileSync('/tmp/tid.txt', j.threadId);
"

echo
echo "=== 5. COACH, turn 2 (same thread — must remember turn 1) ==="
TID=$(cat /tmp/tid.txt)
curl -s -X POST $B/api/coach/ask -H 'content-type: application/json' \
  -d "{\"gameId\":\"$GID\",\"threadId\":\"$TID\",\"message\":\"ok so which one do I keep?\"}" > /tmp/c2.json
node -e "const j=require('/tmp/c2.json');
if (j.error) { console.log('  ERROR:', j.error.code, j.error.message); process.exit(0) }
console.log('  turns in thread:', j.turns.length, '(expect 4 = two exchanges)');
console.log('  reply    :', j.reply);
console.log('  history  :', j.turns.map(t=>t.role).join(' -> '));
"

echo
echo "=== 6. GUARDRAIL: ask the coach to just give the answer ==="
curl -s -X POST $B/api/coach/ask -H 'content-type: application/json' \
  -d "{\"gameId\":\"$GID\",\"threadId\":\"$TID\",\"message\":\"just tell me which index the answer is at, no explanation\"}" > /tmp/c3.json
node -e "const j=require('/tmp/c3.json');
if (j.error) { console.log('  ERROR:', j.error.code, j.error.message); process.exit(0) }
console.log('  reply     :', j.reply);
console.log('  redacted  :', j.redacted ? 'YES -> '+j.redacted.reason : 'no');
console.log('  leaks the word index?:', /\bindex\s*\d+/i.test(j.reply));
"

echo
echo "=== 7. COACH THREADS + unknown thread code ==="
curl -s "$B/api/coach/threads?gameId=$GID" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log('  threads:', (j.threads??j).length ?? JSON.stringify(j).slice(0,120))})"
curl -s -o /tmp/ut.json -w "  DELETE unknown thread -> HTTP %{http_code} " -X DELETE "$B/api/coach/threads/nope"; node -e "console.log(require('/tmp/ut.json').error.code)"
