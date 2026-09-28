/**
 * The eight template themes.
 *
 * This is the only "creative" data in the whole provider chain. It exists so
 * that tier 4 can produce a *fresh* theme for every seed with zero I/O — which
 * is what makes "Retry with New Game" visibly different even when every LLM
 * tier is dormant. Everything a theme supplies is vocabulary + palette; all
 * algorithmic content is derived from the ProblemMeta, never hand-written here.
 */

import type { GameSpec } from '@dsa/game-schema'

export interface ThemeDef {
  readonly key: string
  /** `{object}` `{objectPlural}` `{place}` `{action}` `{target}` `{lower}` `{equal}` `{higher}` `{n}` */
  readonly titleTemplate: string
  /** Same placeholders as the title, plus `{problem}` and `{n}`. */
  readonly storyTemplate: string
  readonly genre: GameSpec['theme']['genre']
  readonly tone: GameSpec['theme']['tone']
  readonly palette: GameSpec['visual']['palette']
  readonly object: string
  readonly objectPlural: string
  readonly place: string
  readonly actionVerb: string
  readonly target: string
  readonly lowerWord: string
  readonly equalWord: string
  readonly higherWord: string
  /** Board caption shown above the play area. */
  readonly boardLabel: string
  /**
   * Short flavour tails appended to the title. Rotated by the seed so that two
   * different seeds landing on the same theme still read differently.
   */
  readonly titleTails: readonly string[]
  /** Glyph map keyed by the theme's own nouns. */
  readonly glyphs: Readonly<Record<string, string>>
  /** Noun used in the "you finished" line. */
  readonly successNoun: string
}

export const TEMPLATE_THEMES: readonly ThemeDef[] = [
  {
    key: 'treasure-vault',
    titleTemplate: 'The {target} of the {place}',
    storyTemplate:
      'A band of {objectPlural} has been laid out along the {place}, and only one of them opens ' +
      'the {target}. The trap resets itself the moment you touch it in the wrong order, so work ' +
      'strictly in order and never guess. This is {problem}, and it has to be done by the book.',
    genre: 'fantasy',
    tone: 'tense',
    palette: {
      background: '#150f0b',
      primary: '#e8c37a',
      accent: '#c2410c',
      success: '#65a30d',
      danger: '#b91c1c',
    },
    object: 'lantern',
    objectPlural: 'lanterns',
    place: 'sunken vault corridor',
    actionVerb: 'inspect',
    target: 'obsidian vault',
    lowerWord: 'dimmer',
    equalWord: 'identical',
    higherWord: 'brighter',
    boardLabel: 'the lantern row',
    titleTails: ['Sealed', 'First Light', 'The Long Count'],
    glyphs: { lantern: '🏮', vault: '💎', corridor: '🕯️' },
    successNoun: 'vault',
  },
  {
    key: 'space-station',
    titleTemplate: 'Signal Lost in the {place}',
    storyTemplate:
      'The {place} is a ring of {objectPlural}, each one a telemetry frame from a different part ' +
      'of the station. Somewhere in that ring is the {target} — the frame that tells you which ' +
      'antenna is dead. Scramble it and the station goes dark. This is {problem}; the hardware ' +
      'does not care how clever you are, only in what order you read the frames.',
    genre: 'space',
    tone: 'calm',
    palette: {
      background: '#050914',
      primary: '#93c5fd',
      accent: '#22d3ee',
      success: '#34d399',
      danger: '#fb7185',
    },
    object: 'satellite',
    objectPlural: 'satellites',
    place: 'station telemetry ring',
    actionVerb: 'poll',
    target: 'carrier lock',
    lowerWord: 'weaker',
    equalWord: 'duplicate',
    higherWord: 'stronger',
    boardLabel: 'the telemetry ring',
    titleTails: ['Drift', 'Cold Start', 'Signal Loss'],
    glyphs: { satellite: '🛰️', station: '📡', antenna: '📶' },
    successNoun: 'lock',
  },
  {
    key: 'detective-case',
    titleTemplate: 'Case File: the {place}',
    storyTemplate:
      'Twelve {objectPlural} are booked into the {place} of the {target} case, and the filing ' +
      'drawer will only open for the one that matches. Every {object} you turn over is logged, ' +
      'and logged {objectPlural} cannot be re-examined. This is {problem}: do the paperwork the ' +
      'way the manual says, in the order the manual says.',
    genre: 'detective',
    tone: 'mysterious',
    palette: {
      background: '#1a1613',
      primary: '#d6c9a8',
      accent: '#a16207',
      success: '#4d7c0f',
      danger: '#9f1239',
    },
    object: 'suspect',
    objectPlural: 'suspects',
    place: 'archive annexe',
    actionVerb: 'cross-examine',
    target: 'sealed confession',
    lowerWord: 'weaker',
    equalWord: 'identical',
    higherWord: 'stronger',
    boardLabel: 'the suspect line-up',
    titleTails: ['Cold Trail', 'Missing Hours', 'The Late Edition'],
    glyphs: { suspect: '🕵️', file: '🗂️', drawer: '🗄️' },
    successNoun: 'file',
  },
  {
    key: 'kitchen-brigade',
    titleTemplate: 'Service at the {place}',
    storyTemplate:
      'Dinner service is live and the {place} is stacked with {objectPlural}, each stamped with a ' +
      'heat level. The pass only lifts the {target} when the plates go out in the right order, and ' +
      'the chef will not wait. This is {problem} — mise en place, then execute, then send.',
    genre: 'cooking',
    tone: 'playful',
    palette: {
      background: '#1f1109',
      primary: '#fed7aa',
      accent: '#ea580c',
      success: '#84cc16',
      danger: '#dc2626',
    },
    object: 'plate',
    objectPlural: 'plates',
    place: 'cold pass',
    actionVerb: 'plate up',
    target: 'fire order',
    lowerWord: 'cooler',
    equalWord: 'identical',
    higherWord: 'hotter',
    boardLabel: 'the pass shelf',
    titleTails: ['Lunch Rush', 'Two Seatings', 'Closing Service'],
    glyphs: { plate: '🍽️', pass: '🍳', tray: '🍱' },
    successNoun: 'ticket',
  },
  {
    key: 'deep-sea-salvage',
    titleTemplate: 'Salvage of the {place}',
    storyTemplate:
      'Two thousand metres down, the {place} is a line of {objectPlural} lashed to the winch. One ' +
      'of them is rigged to the {target}, and the rig goes off if you cut in the wrong sequence. ' +
      'The surface is not watching. This is {problem} — check the gauge, decide, move once.',
    genre: 'nature',
    tone: 'calm',
    palette: {
      background: '#04131f',
      primary: '#a5f3fc',
      accent: '#0e7490',
      success: '#22c55e',
      danger: '#ef4444',
    },
    object: 'pressure pod',
    objectPlural: 'pressure pods',
    place: 'salvage line',
    actionVerb: 'sound',
    target: 'pressure hull',
    lowerWord: 'shallower',
    equalWord: 'matched',
    higherWord: 'deeper',
    boardLabel: 'the salvage line',
    titleTails: ['Low Tide', 'The Second Descent', 'Hull Breach'],
    glyphs: { pod: '🫧', hull: '🛟', line: '⚓' },
    successNoun: 'hull',
  },
  {
    key: 'mountain-expedition',
    titleTemplate: 'The {place} Crossing',
    storyTemplate:
      'The {place} runs for {n} pitches of loose rock, and each pitch is a survey {object} with a ' +
      'grade. You must find the grade that marks the {target} camp before the weather turns. A ' +
      'wrong turn costs you the whole party. This is {problem}: read the grade, then commit.',
    genre: 'nature',
    tone: 'tense',
    palette: {
      background: '#111827',
      primary: '#e5e7eb',
      accent: '#f59e0b',
      success: '#10b981',
      danger: '#ef4444',
    },
    object: 'pitch',
    objectPlural: 'pitches',
    place: 'north ridge',
    actionVerb: 'survey',
    target: 'high camp',
    lowerWord: 'easier',
    equalWord: 'level',
    higherWord: 'steeper',
    boardLabel: 'the ridge',
    titleTails: ['Col', 'Whiteout', 'Last Light'],
    glyphs: { pitch: '🧗', camp: '⛺', ridge: '🏔️' },
    successNoun: 'camp',
  },
  {
    key: 'robot-factory',
    titleTemplate: 'Assembly Line {n}',
    storyTemplate:
      'Line {n} of the factory has {n} unprogrammed actuator {objectPlural} queued on the rail. ' +
      'One of them must be flagged for the {target} unit; flag the wrong one and the rail jams ' +
      'for a week. The line does not slow down. This is {problem}: read each unit, then route it.',
    genre: 'sci-fi',
    tone: 'tense',
    palette: {
      background: '#0c0a09',
      primary: '#d6d3d1',
      accent: '#0891b2',
      success: '#16a34a',
      danger: '#dc2626',
    },
    object: 'actuator',
    objectPlural: 'actuators',
    place: 'assembly line',
    actionVerb: 'test',
    target: 'chassis slot',
    lowerWord: 'under',
    equalWord: 'twin',
    higherWord: 'over',
    boardLabel: 'the rail',
    titleTails: ['Night Shift', 'Line Halt', 'Recalibration'],
    glyphs: { actuator: '🤖', rail: '🛤️', chassis: '⚙️' },
    successNoun: 'slot',
  },
  {
    key: 'library-archive',
    titleTemplate: 'The {place} Concordance',
    storyTemplate:
      'The {place} holds {n} catalogue {objectPlural}, each stamped with a call number. The ' +
      'concordance that names the {target} is written in one of them, and the reading room closes ' +
      'at nine. Take the wrong folio and you lose the night. This is {problem}, by the book.',
    genre: 'everyday',
    tone: 'calm',
    palette: {
      background: '#131110',
      primary: '#e7e5e4',
      accent: '#78716c',
      success: '#4ade80',
      danger: '#f87171',
    },
    object: 'folio',
    objectPlural: 'folios',
    place: 'card catalogue',
    actionVerb: 'consult',
    target: 'concordance',
    lowerWord: 'earlier',
    equalWord: 'same',
    higherWord: 'later',
    boardLabel: 'the card catalogue',
    titleTails: ['Closing Time', 'The Lost Call Number', 'Card Order'],
    glyphs: { folio: '📜', catalogue: '🗃️', concordance: '📖' },
    successNoun: 'concordance',
  },
] as const
