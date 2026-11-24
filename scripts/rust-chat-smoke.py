"""Differential durable chat/SSE test with a local mock, legacy DB, and old tokens."""
import json
from pathlib import Path
import runpy
import sqlite3
import tempfile
import threading
import urllib.request
import urllib.error
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path(__file__).resolve().parent.parent
H=runpy.run_path(str(ROOT/'scripts/rust-learning-smoke.py'))
request,server=H['request'],H['server']
class Provider(BaseHTTPRequestHandler):
    mode='normal';calls=[]
    def log_message(self,*args):pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert self.headers.get('Authorization')=='Bearer test-key'
        assert self.headers.get('User-Agent')=='dsa-game/0.1.0'
        assert self.headers.get('x-opencode-session')
        self.calls.append(body)
        if body.get('stream'):
            assert body['max_tokens']==16000
            if self.mode=='failure':
                data=b'data: {"error":{"message":"test failure"}}\n\n'
            elif self.mode=='missing-done':
                data=b'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
            else:
                data='data: {"choices":[{"delta":{"content":"Arrays 😀"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":" use contiguous storage."}}]}\r\n\r\ndata: [DONE]\r\n\r\n'.encode()
            content_type='text/event-stream'
        else:
            assert body['max_tokens']==5000
            content='invalid JSON' if self.mode=='fallback' else json.dumps({'actions':[{'type':'plan','title':'Arrays','content':'Day 1: arrays'}]})
            data=json.dumps({'choices':[{'message':{'content':content}}]}).encode();content_type='application/json'
        self.send_response(200);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
def normalize(value):
    if isinstance(value,list):return [normalize(v) for v in value]
    if isinstance(value,dict):
        return {k:'<time>' if k in ['createdAt','updatedAt'] and ('role'in value or 'title'in value) else '<message>' if k=='id' and value.get('role') in ['user','assistant'] else '<plan>' if k=='id' and (len(value)==1 or isinstance(v,str) and v.startswith('plan_')) else normalize(v) for k,v in value.items()}
    return value

def stream(base,path,body,token):
    req=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+token},method='POST')
    try:response=urllib.request.urlopen(req,timeout=15)
    except urllib.error.HTTPError as error:response=error
    with response:
        data=response.read().decode()
        if response.status!=200:return response.status,json.loads(data)
        assert response.headers['Content-Type'].startswith('text/event-stream')
        return response.status,[json.loads(s.removeprefix('data: ')) for s in data.split('\n\n') if s]

def exercise(base,accounts,games,threads):
    alice,bob=[a['token'] for a in accounts];thread=threads[0];path=f'/api/learning/threads/{thread}'
    results=[]
    def send(label,body,token=alice):
        status,data=stream(base,path+'/messages',body,token);results.append({'case':label,'status':status,'data':normalize(data)});return data
    context={'history':True,'resume':True,'target':True,'historyFilter':{'topic':next(p['topic'] for p in json.loads((ROOT/'services/api-rust/data/reference.json').read_text())['problems'] if p['id']=='binary-search')}}
    # Keep references, timestamps and IDs stable in both copies.
    a={'requestId':'chat-0001','text':'Explain binary search','context':context}
    send('unknown owner',{},bob);send('validation',{})
    send('missing problem',dict(a,context={'reference':{'type':'problem','problemId':'missing'}}))
    send('missing run',dict(a,context={'reference':{'type':'run','gameId':'missing'}}))
    send('missing step',dict(a,context={'reference':{'type':'run','gameId':games[0],'step':999}}))
    send('unknown interview',dict(a,context={'reference':{'type':'interview','kitId':'kit-fixture','questionId':'missing'}}))
    first=send('normal',dict(a,context=dict(context,reference={'type':'problem','problemId':'binary-search'})))
    duplicate=send('replay',dict(a,context=dict(context,reference={'type':'problem','problemId':'binary-search'})))
    assert duplicate==[first[-1]]
    send('regen reject',dict(a,requestId='chat-0002',text='Different text',regenerate=True))
    send('regen',dict(a,requestId='chat-0003',regenerate=True))
    send('run reference',dict(a,requestId='chat-0004',context={'reference':{'type':'run','gameId':games[0]}}))
    send('interview reference',dict(a,requestId='chat-0005',context={'reference':{'type':'interview','kitId':'kit-fixture','questionId':'question-fixture'}}))
    Provider.mode='fallback'
    send('deterministic cards',dict(a,requestId='chat-0006',text='Generate hard binary search practice',context={'history':False}))
    Provider.mode='missing-done'
    send('partial failure',dict(a,requestId='chat-0007',context={'history':False}))
    # Node/Rust deliberately cool failed providers for 15 seconds. A second
    # request during cooldown must fail without making another upstream call.
    send('cooldown',dict(a,requestId='chat-0008',context={'history':False}))
    Provider.mode='normal'
    assistant=first[-1]['message']
    selected={'messageId':assistant['id'],'index':0,'requestId':'card-0001'}
    for label,body,token in [('plan',selected,alice),('plan replay',dict(selected,requestId='card-0002'),alice),('card owner',selected,bob),('bad card',{},alice),('missing card',dict(selected,index=20),alice)]:
        status,data,_=request(base,path+'/actions','POST',body,token);results.append({'case':label,'status':status,'data':normalize(data)})
    for label,path_to_read in [('messages',path+'?limit=100'),('plans','/api/learning/plans')]:
        status,data,_=request(base,path_to_read,'GET',None,alice);results.append({'case':label,'status':status,'data':normalize(data)})
    status,data,_=request(base,path+'/cancel','POST',{},bob);results.append({'case':'cancel owner','status':status,'data':data})
    return results

def normalized_calls(calls):
    out=[]
    for call in calls:
        call=json.loads(json.dumps(call));messages=call['messages']
        if call.get('stream'):
            system=messages[0]['content'];prefix,tail=system.split('\nSelected account data: ',1);context,tail=tail.split('\nSource links: ',1);sources,older=tail.split('\nEarlier conversation excerpts (incomplete summary): ',1)
            messages[0]['content']={'prefix':prefix,'context':json.loads(context),'sources':json.loads(sources),'older':older}
        else:messages[1]['content']=json.loads(messages[1]['content'])
        out.append(call)
    return out
if __name__=='__main__':
    binary=ROOT/'services/api-rust/target/release/dsa-api';fake=ThreadingHTTPServer(('127.0.0.1',0),Provider);thread=threading.Thread(target=fake.serve_forever,daemon=True);thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='dsa-chat-parity-')as temp:
            directory=Path(temp);legacy=directory/'legacy.sqlite';accounts,games,threads=H['seed'](legacy,directory)
            with sqlite3.connect(legacy)as db:
                owner=accounts[0]['user']['id']
                # Long imported history exercises bounded older excerpts.
                for i in range(1200):
                    m={'id':f'old-{i}','role':'assistant','text':f'History {i} 😀'+'x'*230,'status':'complete','createdAt':i,'requestId':f'old-request-{i}','actions':[],'sources':[]}
                    db.execute('INSERT INTO learning_messages VALUES(?,?,?,?)',(m['id'],threads[0],m['requestId'],json.dumps(m)))
                target={'goal':'Prepare','companyId':'custom','customCompany':'','seniority':'mid','focusAreas':[]};questions=[{'id':'question-fixture','kind':'concept','prompt':'Explain arrays','whyRelevant':'Learn DSA'}]
                db.execute('INSERT INTO interview_kits VALUES(?,?,?,?,?,?)',('kit-fixture',owner,json.dumps(target),json.dumps(questions),'template',1))
                db.execute('UPDATE practice_runs SET reflection_json=? WHERE game_id=?',(json.dumps({'retention':'Recall','integration':'Apply','skipped':False}),games[0]))
            H['ENV'].update(OPENCODE_GO_ENABLED='1',OPENCODE_GO_API_KEY='test-key',OPENCODE_GO_MODEL='differential-model',OPENCODE_GO_BASE_URL=f'http://127.0.0.1:{fake.server_port}',OPENCODE_GO_TIMEOUT_MS='5000',DSA_SSE_BYTES='1024')
            results={};calls={}
            for runtime,command in [('node',['node','--import=tsx','src/index.ts']),('rust',[str(binary)])]:
                Provider.mode='normal';Provider.calls=[];dest=directory/f'{runtime}.sqlite'
                with sqlite3.connect(legacy)as src,sqlite3.connect(dest)as dst:src.backup(dst)
                with server(command,dest,directory)as base:results[runtime]=exercise(base,accounts,games,threads)
                calls[runtime]=normalized_calls(Provider.calls)
            assert len(results['node'])==len(results['rust'])
            for node,rust in zip(results['node'],results['rust']):assert node==rust,json.dumps({'node':node,'rust':rust},ensure_ascii=False,indent=2)
            for index,(node,rust)in enumerate(zip(calls['node'],calls['rust'])):assert node==rust,json.dumps({'call':index,'node':node,'rust':rust},ensure_ascii=False,indent=2)
            assert len(calls['node'])==len(calls['rust'])
            print(json.dumps({'chatParity':'passed','requestsCompared':len(results['node']),'providerCallsPerRuntime':len(calls['node']),'paidProviderCalls':0,'fullMigrationAccepted':False},indent=2))
    finally:fake.shutdown();fake.server_close()
