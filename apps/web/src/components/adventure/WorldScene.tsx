import type { WorldDefinition } from '@/lib/adventure'

/** Decorative scenery only: real game values always remain accessible HTML. */
export function WorldScene({ world, compact = false }: { world: WorldDefinition; compact?: boolean }) {
  return <svg className={compact ? 'world-scene compact' : 'world-scene'} viewBox="0 0 320 150" aria-hidden="true" focusable="false">
    <ellipse cx="160" cy="128" rx="125" ry="16" fill={world.color} opacity=".12" />
    <g stroke="#24344b" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round">
      <path d="M26 103 Q65 67 105 103 T190 103 T296 103" fill="none" stroke={world.color} opacity=".22" />
      {world.id === 'arrays' && <>
        <path d="M63 94V47M251 94V47" /><circle cx="63" cy="43" r="29" fill="#91b974"/><circle cx="251" cy="43" r="29" fill="#91b974"/>
        <circle cx="51" cy="44" r="7" fill="#f18b69"/><circle cx="75" cy="34" r="7" fill="#f18b69"/><circle cx="244" cy="41" r="7" fill="#f18b69"/>
        {[100,145,190].map((x,i)=><g key={x}><rect x={x} y={76-i*8} width="37" height="40" rx="5" fill="#eac28b"/><path d={`M${x+5} ${82-i*8}l27 28m0-28l-27 28`} stroke="#b4824b"/></g>)}
      </>}
      {world.id === 'sorting' && <>
        <path d="M67 112v18m186-18v18"/><rect x="49" y="101" width="223" height="14" rx="5" fill="#c08a61"/>
        {[32,48,66,83].map((h,i)=><rect key={h} x={76+i*43} y={100-h} width="32" height={h} rx="6" fill={['#efaa66','#ed8368','#9fbf98','#91afd8'][i]}/>)}
        <path d="M32 53l9 9 9-9m223-8 9-9 9 9" fill="none"/>
      </>}
      {world.id === 'stack' && <>
        {[0,1,2].map(i=><rect key={i} x={116-i*3} y={89-i*30} width="89" height="27" rx="6" fill={['#a496cd','#c1b4e3','#e0cef0'][i]}/>)}
        <path d="M232 22v39m-9-10 9 10 9-10" fill="none"/><path d="M104 123h115"/>
      </>}
      {world.id === 'queue' && <>
        <path d="M49 112h220M45 31h229"/><path d="M60 31v16m198-16v16"/>
        {[0,1,2,3].map(i=><g key={i}><rect x={66+i*47} y="77" width="31" height="32" rx="10" fill={['#8fc8bd','#f5cd7d','#e5a3a1','#aabbe7'][i]}/><circle cx={82+i*47} cy="62" r="13" fill="#fff3db"/><path d={`M${78+i*47} 62h1m6 0h1`} /></g>)}
        <path d="M44 79l-13 9 13 9m239-18-13 9 13 9" fill="none"/>
      </>}
      {world.id === 'binary-search' && <>
        <path d="M132 125l28-51 28 51m-39-20h24" fill="none"/><path d="M110 51l82-32 16 34-82 32z" fill="#94ace0"/><path d="M195 17l17 37" strokeWidth="9"/>
        <path d="M65 33v18m-9-9h18m177 24v16m-8-8h16" stroke="#b18435"/><circle cx="91" cy="91" r="5" fill="#f6cd79"/>
      </>}
      {world.id === 'linked-list' && <>
        <path d="M44 119h239m-230 7h222"/><path d="M112 91h18m62 0h18"/>
        {[0,1,2].map(i=><g key={i}><rect x={51+i*80} y="59" width="62" height="44" rx="9" fill={['#d897b1','#edc188','#9ec8bc'][i]}/><rect x={61+i*80} y="68" width="22" height="17" rx="3" fill="#fff9ec"/><circle cx={65+i*80} cy="108" r="7" fill="#24344b"/><circle cx={99+i*80} cy="108" r="7" fill="#24344b"/></g>)}
      </>}
    </g>
  </svg>
}
export function RobotGuide({ children }: { children?: React.ReactNode }) {
  return <div className="robot-guide"><svg viewBox="0 0 64 70" width="52" height="57" aria-hidden="true"><g stroke="#24344b" strokeWidth="3"><path d="M32 17V8"/><circle cx="32" cy="6" r="4" fill="#ef946b"/><rect x="8" y="18" width="48" height="35" rx="12" fill="#f5cc76"/><rect x="17" y="27" width="30" height="15" rx="6" fill="#24344b"/><path d="M20 54v8m24-8v8"/></g><g fill="#fff6e4"><circle cx="25" cy="34" r="3"/><circle cx="39" cy="34" r="3"/></g></svg>{children && <div>{children}</div>}</div>
}
