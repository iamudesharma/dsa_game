import {writeFile} from 'node:fs/promises'
import {COACH_SYSTEM_RULES} from '../packages/game-schema/src/index.js'
await writeFile(new URL('../services/api-rust/data/coach-prompt.json',import.meta.url),JSON.stringify(COACH_SYSTEM_RULES)+'\n')
