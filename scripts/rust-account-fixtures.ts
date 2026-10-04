/** Differential expected results from the existing implementation, never runtime code. */
import { writeFileSync } from 'node:fs'
import { parseResumeText, emptyResume, templateInterviewKit, COMPANY_PROFILES, TargetSchema, ResumeSchema, resumeToText, validateInterviewKit } from '../packages/account/src/index.js'
import { groundedResume, mergeResumes } from '../services/api/src/account/extract.js'
const texts = [
 '', 'Ada Lovelace\nada@example.com',
 'Summary: Backend engineer\nSkills: Rust, SQL; Go | Python / C++',
 'EXPERIENCE\nSenior Engineer, Northwind Labs 2019 - Present\n- Built payment APIs\nEDUCATION\nBSc Computer Science, TU Berlin 2014 - 2018\nPROJECTS\nIndexer: Fast search over events\nSkills\nRust; SQL; rust',
 'EXPERIENCE\nEngineer, Payments team\n* Shipped safer retries\nAcme Corp, Platform team 2020 to 2024\n1. Measured memory\nProjects\n- Worker — Processes jobs\n- Standalone prototype\nEducation\nTU Berlin — BSc Computer Science — Systems\nSkills\nThis is a long sentence that must never become a skill because it has too many words.',
 'Experience\nDeveloper at Acme Inc Jan 2021\n• Created cache\nEngineer @ OpenAI 2020—2025\n▪ Tested streaming\nSummary\nClear communication\nProjects\nSearch | Indexing logs\nSkills\n- C++\n1. TypeScript',
 'skills: Go, SQL\nUnknown heading\nEducation\n- Bullet school\n2014 - 2018\nProjects\n'+ 'x'.repeat(201),
 'Summary: 😀 Engineer\nSkills: C#, C++, Node.js\nExperience\nFounder — AI Lab 2020–current\n- Improved latency\n- '+ 'b'.repeat(401),
 'Skills\n'+ Array.from({length:62},(_,i)=>`Skill ${i}`).join(', '),
 'Education\n'+ Array.from({length:12},(_,i)=>`School ${i} — Degree ${i}`).join('\n'),
 'Projects\n'+ Array.from({length:22},(_,i)=>`Project ${i}: Description`).join('\n'),
 'Experience\n'+ Array.from({length:21},(_,i)=>`Engineer at Corp ${i}`).join('\n'),
 'Experience\n2019 - Present\n- No header\nProjects\n- Empty:\nEducation\nPh.D Physics, University 2010 to 2015\nSkills\n* Rust\n2) SQL\nNode.js / Git',
]
function normalize(v:any):any {if(Array.isArray(v))return v.map(normalize);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([key,val])=>[key,key==='id'&&typeof val==='string'&&/^(exp|edu|proj|skill):/.test(val)?val.split(':')[0]+':fixture':normalize(val)]));return v;}
const parses=texts.map(text=>({text,result:normalize(parseResumeText(text))}));
const profiles=[emptyResume(),ResumeSchema.parse({summary:'Backend engineer',experience:[{id:'exp1',title:'Engineer',company:'Northwind Labs',bullets:['Built cache']}],projects:[{id:'proj1',name:'Indexer',description:'Search events'}],skills:[{id:'skill1',name:'Rust'},{id:'skill2',name:'SQL'}]}),ResumeSchema.parse({experience:Array.from({length:5},(_,i)=>({id:'exp'+i,title:'Engineer '+i,company:'Company '+i})),skills:[{id:'skill1',name:'Python'}]})];
const kits=[];
for(const resume of profiles)for(const companyId of [...COMPANY_PROFILES.map(c=>c.id),'custom'])for(const seed of [0,1,7,30,4294967295,9007199254740991])for(const newAngle of [false,true]){
 const target=TargetSchema.parse({goal:'Prepare',companyId,customCompany:'Example company'});
 kits.push({resume,target,seed,newAngle,result:templateInterviewKit({resume,target,seed,newAngle})});
}
const source='Summary: Backend engineer\nContact: Ada at ada@example.com in Berlin\nExperience\nEngineer at Northwind Labs 2019 - Present\n- Built a cache with Rust\nEducation\nBSc Computer Science, TU Berlin 2014 - 2018\nProjects\nIndexer: Search events\nSkills: Rust, SQL';
const candidates=[
 ResumeSchema.parse({summary:'Backend engineer',contact:{name:'Ada',email:'ada@example.com',location:'Berlin'},experience:[{id:'exp:1',title:'Engineer',company:'Northwind Labs',start:'2019',end:'Present',bullets:['Built a cache with Rust']}],skills:[{id:'skill:1',name:'Rust'},{id:'skill:2',name:'sql'}]}),
 ResumeSchema.parse({experience:[{id:'fake',title:'Astronaut',company:'Mars Space',bullets:['Launched rockets']}],skills:[{id:'skill:1',name:'Quantum Robotics'}]}),
 ResumeSchema.parse({contact:{name:'Imaginary Name',email:'fake@moon.com'},experience:[{id:'exp:1',title:'Engineer',company:'Fake Empire',start:'2099',end:'Present',bullets:['Built a cache with Rust']}],education:[{id:'edu:1',school:'TU Berlin',degree:'BSc Computer Science',field:'Invented field',start:'2099',end:'2100'}],projects:[{id:'proj:1',name:'Indexer',description:'Search events',tech:['Rust','Teleportation'],link:'https://example.com'}],skills:[{id:'skill:1',name:'Rust'},{id:'skill:2',name:'rust'},{id:'skill:3',name:'Holograms'}]}),
 {bad:true},
];
const groundings=candidates.map(raw=>({raw,source,result:groundedResume(raw,source)}));
const floor=ResumeSchema.parse(normalize(parseResumeText(source).resume));
const merges=candidates.slice(0,3).map(raw=>({model:groundedResume(raw,source).resume,fallback:floor,result:mergeResumes(groundedResume(raw,source).resume,floor)}));
const educationModel=ResumeSchema.parse({education:[{id:'edu:1',school:'TU Berlin',degree:'BSc Computer Science'}]});
const educationFallback=ResumeSchema.parse({education:[{id:'edu:2',school:'BSc Computer Science',degree:'TU Berlin',field:'Systems',start:'2014'}]});
merges.push({model:educationModel,fallback:educationFallback,result:mergeResumes(educationModel,educationFallback)});
const digest=profiles.map(resume=>({resume,result:resumeToText(resume)}));
const good=kits[0].result;const validations=[];
for(const mutate of [(k:any)=>k,(k:any)=>({...k,unknown:true}),(k:any)=>({...k,questions:k.questions.map((q:any,i:number)=>i===0?{...q,sourceRef:'invented'}:q)}),(k:any)=>({...k,questions:k.questions.map((q:any,i:number)=>i===0?{...q,practice:{problemId:'invented'}}:q)})]){const raw=mutate(good);validations.push({raw,resume:profiles[0],result:validateInterviewKit(raw,profiles[0])});}
for(const phrase of ['70% of candidates','Company always asks this','superday','onsite loop A','round 7','secret round','interviewer John Smith','guaranteed offer','$100k salary','100k comp','ordinary interview question']){const raw={...good,questions:good.questions.map((q,i)=>i===0?{...q,prompt:phrase}:q)};validations.push({raw,resume:profiles[0],result:validateInterviewKit(raw,profiles[0])});}
const result={parses,kits,groundings,merges,digest,validations};
writeFileSync(new URL('../services/api-rust/tests/fixtures/account.json',import.meta.url),JSON.stringify(result)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,v.length]))));
