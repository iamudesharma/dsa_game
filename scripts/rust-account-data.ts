/** Static wording only. Runtime algorithms are implemented in Rust. */
import { readFileSync, writeFileSync } from 'node:fs'
import { CODING_BY_AXIS, CONCEPT_QUESTIONS, ML_QUESTIONS, SYSTEM_QUESTIONS } from '../packages/account/src/questions.js'
import { FABRICATION_PATTERNS } from '../packages/account/src/validate.js'
import { resolveCompany } from '../packages/account/src/companies.js'
import { PROBLEMS } from '../packages/game-schema/src/index.js'
import { getOracle } from '../packages/dsa-oracles/src/index.js'
export const accountData = {
  coding: CODING_BY_AXIS, concepts: CONCEPT_QUESTIONS, ml: ML_QUESTIONS, system: SYSTEM_QUESTIONS,
  fabrication: FABRICATION_PATTERNS.map(p=>({id:p.id,source:p.re.source,flags:p.re.flags,reason:p.reason})),
  customCompany: resolveCompany({companyId:'custom'}),
  playable: PROBLEMS.filter(p=>getOracle(p.id)!==undefined).map(p=>p.id),
}
const output = new URL('../services/api-rust/data/account.json', import.meta.url)
const text = JSON.stringify(accountData,null,2)+'\n'
if (process.argv.includes('--check')) {
  if(readFileSync(output,'utf8')!==text) throw new Error('Rust account reference data drifted')
} else writeFileSync(output,text)
