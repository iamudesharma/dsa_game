#!/usr/bin/env bash
# Prove a generated game is actually completable through the public API:
# follow the oracle's own legalActions until the game ends.
set -uo pipefail
B=http://127.0.0.1:8787
GID=$(cat /tmp/gid.txt)

echo "=== driving a full game purely from the API's own guidance ==="
node - "$GID" <<'JS'
const gid = process.argv[2]
const B = 'http://127.0.0.1:8787'
const post = async (p, b) => (await fetch(B + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json()

const g = await (await fetch(`${B}/api/game/${gid}`)).json()
let st = g.state
const values = st.instance.values
const target = st.instance.target
console.log(`  board  : [${values.join(', ')}]  target ${target}`)

let guard = 0
while (st.phase === 'playing' && guard++ < 40) {
  const mid = Number(st.variables.mid)
  let action
  if (st.internal.midChosen !== true) {
    action = { type: 'selectObject', objectId: `v${mid}` }
  } else {
    const rel = values[mid] < target ? 'gt' : values[mid] > target ? 'lt' : 'eq'
    action = { type: 'comparePair', aId: `v${mid}`, bId: 'target', relation: rel }
  }
  let r = await post('/api/action', { gameId: gid, action })
  if (r.error) { console.log('  ERROR', r.error.code, r.error.message); process.exit(1) }
  st = r.state
  const f = r.feedback
  console.log(`  ${String(st.progress.steps).padStart(2)}. ${action.type.padEnd(13)} ${f.verdict.padEnd(8)} | ${String(f.teach).slice(0, 60)}`)
  if (f.verdict === 'illegal' || f.verdict === 'wrong') {
    console.log('     !! rejected:', f.headline)
    process.exit(1)
  }
  if (st.internal.midChosen === true && st.internal.hasComparison) {
    const rel = values[mid] < target ? 'gt' : values[mid] > target ? 'lt' : 'eq'
    if (rel === 'eq') {
      // "found" ends the narrowing, but the round is only over once the answer
      // is committed — the oracle asks for one more move here.
      const a2 = { type: 'choosePath', fromId: `v${mid}`, pathId: 'found' }
      const r2 = await post('/api/action', { gameId: gid, action: a2 })
      st = r2.state
      console.log(`  ${String(st.progress.steps).padStart(2)}. choosePath(found) ${r2.feedback.verdict.padEnd(8)} | ${String(r2.feedback.teach).slice(0, 60)}`)
      if (st.phase === 'playing') {
        const idx = values.indexOf(target)
        const a3 = { type: 'submitAnswer', targetId: `v${idx}`, value: String(idx) }
        const r3 = await post('/api/action', { gameId: gid, action: a3 })
        st = r3.state
        console.log(`  ${String(st.progress.steps).padStart(2)}. submitAnswer      ${r3.feedback.verdict.padEnd(8)} | ${String(r3.feedback.teach).slice(0, 60)}`)
      }
    } else {
      const a2 = { type: 'choosePath', fromId: `v${mid}`, pathId: values[mid] < target ? 'right' : 'left' }
      const r2 = await post('/api/action', { gameId: gid, action: a2 })
      st = r2.state
      console.log(`  ${String(st.progress.steps).padStart(2)}. choosePath        ${r2.feedback.verdict.padEnd(8)} | ${String(r2.feedback.teach).slice(0, 60)} | left: ${r2.turnPrompt.indicator.detail}`)
    }
  }
}

console.log('')
console.log(`  RESULT  : ${st.phase.toUpperCase()}  steps=${st.progress.steps} mistakes=${st.progress.mistakes}`)

const d = await (await fetch(`${B}/api/game/${gid}/debrief`)).json()
if (d.error) { console.log('  debrief:', d.error.code); process.exit(0) }
console.log(`  debrief : ${d.answer.text} | ${d.playedTrace.length} frames | ${d.complexity.time}`)
console.log(`  spoilers in debrief mapping: ${/answer is|index \d+ is the answer/i.test(JSON.stringify(d.mapping)) ? 'YES' : 'no'}`)
JS
