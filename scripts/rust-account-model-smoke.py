"""Compare model-backed account routes against a local fake provider (no paid calls)."""
import copy
import json
import os
from pathlib import Path
import runpy
import sqlite3
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT=Path(__file__).resolve().parent.parent
H=runpy.run_path(str(ROOT/'scripts/rust-learning-smoke.py'))
request,server,normalize=H['request'],H['server'],H['normalize']
fixtures=json.loads((ROOT/'services/api-rust/tests/fixtures/account.json').read_text())

class Provider(BaseHTTPRequestHandler):
    mode='resume-grounded'
    calls=[]
    def log_message(self,*args): pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert self.path=='/chat/completions'
        assert self.headers.get('Authorization')=='Bearer test-key'
        assert self.headers.get('User-Agent')=='dsa-game/0.1.0'
        assert self.headers.get('x-opencode-session')
        assert body['model']=='differential-model'
        assert body['max_tokens']==4000
        assert 'stream' not in body
        self.calls.append((self.mode,body))
        status=200
        if self.mode=='failure': status=500; payload={'error':{'message':'Temporary test failure'}}
        elif self.mode=='no-content': payload={'choices':[{'message':{'content':''}}]}
        else:
            if self.mode=='resume-grounded': content=json.dumps({'skills':[{'id':'skill:1','name':'Rust'},{'id':'skill:2','name':'Teleportation'}],'experience':[{'id':'exp:1','title':'Engineer','company':'Northwind Labs','bullets':['Built cache with Rust']}]})
            elif self.mode=='resume-project': content=json.dumps({'projects':[{'id':'proj:1','name':'Indexer','description':'Teleportation holograms'}]})
            elif self.mode=='resume-duplicate': content=json.dumps({'skills':[{'id':'skill:1','name':'Rust'}]})
            elif self.mode=='resume-invented': content=json.dumps({'skills':[{'id':'skill:1','name':'Teleportation'}]})
            elif self.mode=='non-json': content='This is prose rather than JSON.'
            else:
                kit=copy.deepcopy(fixtures['kits'][0]['result'])
                if self.mode=='kit-reference': kit['questions'][0]['sourceRef']='invented-id'
                if self.mode=='kit-fabrication': kit['questions'][0]['prompt']='This company always asks this question.'
                content=json.dumps(kit)
            payload={'choices':[{'message':{'content':content}}]}
        data=json.dumps(payload).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)


def exercise(base,token):
    results=[]
    def call(path,body):
        status,data,_=request(base,path,'POST',body,token)
        results.append({'path':path,'status':status,'body':normalize(data)})
        return data
    source='Experience\nEngineer at Northwind Labs 2019 - Present\n- Built cache with Rust\nSkills: Rust'
    for mode in ['resume-grounded','resume-invented','resume-project','resume-duplicate','non-json','failure','no-content']:
        Provider.mode=mode
        text=source + ('\nProjects\nIndexer: Search events' if mode=='resume-project' else '\nEducation\nTU Berlin — BSc Computer Science\nTU Berlin — BSc Computer Science' if mode=='resume-duplicate' else '')
        call('/api/me/parse-resume',{'text':text,'save':mode=='resume-grounded'})
    for mode in ['kit-valid','kit-reference','kit-fabrication','non-json','failure','no-content']:
        Provider.mode=mode
        call('/api/interview/generate',{'seed':7,'target':{'goal':'Prepare','companyId':'custom'}})
    return results

if __name__=='__main__':
    binary=ROOT/'services/api-rust/target/release/dsa-api'
    fake=ThreadingHTTPServer(('127.0.0.1',0),Provider)
    thread=threading.Thread(target=fake.serve_forever,daemon=True);thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='dsa-account-model-parity-') as temp:
            directory=Path(temp);legacy=directory/'legacy.sqlite'
            # Seed an existing Node account; both runtimes must accept the same token.
            with server(['node','--import=tsx','src/index.ts'],legacy,directory) as base:
                status,account,_=request(base,'/api/auth/signup','POST',{'email':'model@example.com','password':'password123'})
                assert status==200
            H['ENV'].update(OPENCODE_GO_ENABLED='1',OPENCODE_GO_API_KEY='test-key',OPENCODE_GO_MODEL='differential-model',OPENCODE_GO_BASE_URL=f'http://127.0.0.1:{fake.server_port}',OPENCODE_GO_TIMEOUT_MS='5000')
            results={}
            for runtime,command in [('node',['node','--import=tsx','src/index.ts']),('rust',[str(binary)])]:
                destination=directory/f'{runtime}.sqlite'
                with sqlite3.connect(legacy) as src,sqlite3.connect(destination) as dst:src.backup(dst)
                with server(command,destination,directory) as base:results[runtime]=exercise(base,account['token'])
            assert len(results['node'])==len(results['rust'])
            for node,rust in zip(results['node'],results['rust']):assert node==rust,json.dumps({'node':node,'rust':rust},indent=2)
            assert len(Provider.calls)==26
            print(json.dumps({'modelAccountParity':'passed','requestsCompared':len(results['node']),'mockProviderCalls':len(Provider.calls),'paidProviderCalls':0},indent=2))
    finally:fake.shutdown();fake.server_close()
