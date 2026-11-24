#!/usr/bin/env python3
"""Linux Docker acceptance workload. All memory samples come from cgroup v2.

The load generator and mock remote provider run outside the backend container.
Production credentials and databases are never mounted. Routine CI measures Rust
for five minutes. An explicit soak profile retains the separate hour-long check.
"""
import argparse
import concurrent.futures
import http.server
import json
import pathlib
import subprocess
import threading
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent


def docker(*args, check=True):
    return subprocess.run(['docker', *args], check=check, capture_output=True, text=True)


MEMORY_COMMAND = (
    'cat /sys/fs/cgroup/memory.current /sys/fs/cgroup/memory.peak; '
    'echo EVENTS; cat /sys/fs/cgroup/memory.events; '
    'echo STAT; cat /sys/fs/cgroup/memory.stat; '
    'echo PROCESS; cat /proc/1/status; '
    'echo DATABASE; du -k /data/* 2>/dev/null || true'
)


def parse_memory_sample(stdout, elapsed):
    """Keep filesystem/kernel charges visible alongside process RSS."""
    lines = stdout.splitlines()
    result = {'seconds': elapsed, 'current': int(lines[0]), 'peak': int(lines[1]),
              'events': {}, 'stat': {}, 'process': {}, 'databaseKiB': {}}
    section = None
    for line in lines[2:]:
        if line in ('EVENTS', 'STAT', 'PROCESS', 'DATABASE'):
            section = line
            continue
        if section in ('EVENTS', 'STAT'):
            key, value = line.split()
            result['events' if section == 'EVENTS' else 'stat'][key] = int(value)
        elif section == 'PROCESS' and line.startswith(('VmRSS:', 'VmHWM:', 'RssAnon:', 'RssFile:', 'RssShmem:', 'Threads:')):
            key, value, *_ = line.split()
            result['process'][key.rstrip(':')] = int(value)
        elif section == 'DATABASE':
            size, path = line.split(maxsplit=1)
            result['databaseKiB'][path] = int(size)
    return result


class Provider(http.server.BaseHTTPRequestHandler):
    active = peak = calls = 0
    lock = threading.Lock()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        with self.lock:
            Provider.active += 1
            Provider.calls += 1
            Provider.peak = max(Provider.peak, Provider.active)
        try:
            time.sleep(0.25)
            if body.get('stream'):
                text = 'Compare values and explain the invariant. ' * 256
                payload = ('data: ' + json.dumps({'choices':[{'delta':{'content':text}}]}) + '\n\ndata: [DONE]\n\n').encode()
                content_type = 'text/event-stream'
            else:
                text = '{"actions":[]}' if body.get('max_tokens') == 5000 else 'Compare the current values, then make one move.'
                payload = json.dumps({'model': 'benchmark-remote', 'choices': [
                    {'message': {'content': text}}
                ]}).encode()
                content_type = 'application/json'
            self.send_response(200)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        finally:
            with self.lock:
                Provider.active -= 1

    def log_message(self, *_):
        pass


def request(base, path, body=None, token=None, raw=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(base + path, data=data, headers=headers)
    try:
        response = urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        payload = response.read(4 * 1024 * 1024)
        try:
            value = json.loads(payload)
        except (ValueError, UnicodeDecodeError):
            if response.headers.get('Content-Type','').startswith('text/event-stream'):
                events = []
                for frame in payload.decode().replace('\r\n', '\n').split('\n\n'):
                    data_lines = [line[5:].lstrip() for line in frame.splitlines() if line.startswith('data:')]
                    if data_lines and '\n'.join(data_lines) != '[DONE]':
                        events.append(json.loads('\n'.join(data_lines)))
                value = {'events': events}
            else:
                value = None
        return response.status, value, dict(response.headers)


def run(image, label, seconds, output, fixtures, memory_mib=256, profile="quick"):
    peak_limit_mib = {256: 230, 512: 460}[memory_mib]
    name = f'dsa-benchmark-{label}'
    docker('rm', '-f', name, check=False)
    Provider.peak = Provider.calls = 0
    docker('run', '-d', '--name', name, f'--memory={memory_mib}m', f'--memory-swap={memory_mib}m',
           '--cpus=2', '--add-host=host.docker.internal:host-gateway',
           '-p', '127.0.0.1::8787',
           '-e', 'PORT=8787', '-e', 'API_HOST=0.0.0.0', '-e', 'DSA_DB_PATH=/data/dsa.db',
           '-e', 'LOCAL_LLM_ENABLED=0', '-e', 'LAYA_ENABLED=0', '-e', 'OPENCODE_ENABLED=0',
           '-e', 'OPENCODE_GO_ENABLED=0', '-e', 'OPENROUTER_API_KEY=benchmark-only',
           '-e', 'OPENROUTER_BASE_URL=http://host.docker.internal:18999',
           '-e', 'OPENROUTER_MODEL=benchmark-remote', image)
    port = docker('port', name, '8787/tcp').stdout.strip().rsplit(':', 1)[1]
    base = 'http://127.0.0.1:' + port
    counts = {}
    errors = []
    lock = threading.Lock()
    stop = threading.Event()
    samples = []
    activity = [0] * 22

    def call(path, body=None, token=None, raw=None):
        status, value, headers = request(base, path, body, token, raw)
        with lock:
            key = f'{path.split("?")[0]}:{status}'
            counts[key] = counts.get(key, 0) + 1
        if status == 429:
            time.sleep(0.1)
        elif status >= 500:
            raise RuntimeError(f'{path}: {status} {value}')
        return status, value, headers

    def player(index):
        try:
            credentials, token = accounts[index]
            iteration = 0
            while not stop.is_set():
                fixture = fixtures[(index + iteration * 20) % len(fixtures)]
                status, game, _ = call('/api/generate', {
                    'problemId': fixture['id'], 'seed': fixture['seed'],
                    'difficulty': fixture['difficulty'], 'forceTemplate': True}, token)
                if status != 200:
                    continue
                game_id = game['gameId']
                for step in fixture['requests']:
                    if stop.is_set():
                        break
                    path = step['path'].replace('fixture-game', game_id)
                    body = dict(step['body'], gameId=game_id) if 'body' in step else None
                    status, _, _ = call(path, body, token)
                    while status == 429 and not stop.is_set():
                        time.sleep(0.1)
                        status, _, _ = call(path, body, token)
                    if stop.is_set():
                        break
                    if status != 200:
                        raise RuntimeError(f'game step: {path}: {status}')
                if iteration % 10 == 0:
                    call('/api/auth/login', credentials)
                if iteration % 5 == 0:
                    status, _, _ = call('/api/generate', token=token, raw=b' ' * (1024 * 1024 + 1))
                    allowed = (413, 429) if label == 'rust' else (400, 413, 429)
                    if status not in allowed:
                        raise RuntimeError(f'oversized body: {status}')
                iteration += 1
                with lock:
                    activity[index] += 1
                time.sleep(0.1)
        except Exception as error:
            with lock:
                errors.append(f'player {index}: {error}')
            stop.set()

    def coach_loop(index, token):
        status, game, _ = call('/api/generate', {'problemId': 'binary-search', 'seed': index,
                                               'difficulty': 'medium', 'forceTemplate': True}, token)
        if status != 200:
            raise RuntimeError(f'AI game: {status}')
        thread = None
        while not stop.is_set():
            body = {'gameId': game['gameId'], 'message': 'What should I compare next?', 'band': 'builder'}
            if thread:
                body['threadId'] = thread
            status, reply, _ = call('/api/coach/ask', body, token)
            if status == 200:
                if reply['source'] != 'model':
                    raise RuntimeError('remote coach unexpectedly fell back')
                thread = reply['threadId']
                with lock:
                    activity[20 + index] += 1
            elif status != 429:
                raise RuntimeError(f'coach: {status}')

    def ai(index):
        try:
            if index == 0:
                coach_loop(index, accounts[0][1])
                return
            targets = []
            for _, token in accounts:
                status, created, _ = call('/api/learning/threads', {}, token)
                if status != 200:
                    raise RuntimeError(f'stream thread: {status}')
                targets.append((token, '/api/learning/threads/' + created['thread']['id']))
            iteration = 0
            # Preserve the existing 30 requests/user/hour gate. After exercising
            # every account, coach keeps the second AI worker active all hour.
            while not stop.is_set() and iteration < 30 * len(targets):
                token, path = targets[iteration // 30]
                body = {'requestId':f'benchmark-chat-{iteration:08d}','text':'Explain binary search', 'context':{'history':True}}
                status, reply, _ = call(path + '/messages', body, token)
                if status == 200:
                    events = reply['events']
                    if not events or events[-1]['type'] != 'complete' or events[-1]['message']['status'] != 'complete':
                        raise RuntimeError('stream failed to complete')
                    if iteration % 10 == 0:
                        status, replay, _ = call(path + '/messages', body, token)
                        if status == 200 and replay['events'][-1] != events[-1]:
                            raise RuntimeError('stream replay changed the saved completion')
                        status, history, _ = call(path + '?limit=10', token=token)
                        if status == 200 and len(history['messages']) > 10:
                            raise RuntimeError('message pagination exceeded limit')
                        if status not in (200, 429):
                            raise RuntimeError(f'message pagination: {status}')
                    iteration += 1
                    with lock:
                        activity[21] += 1
                elif status != 429:
                    raise RuntimeError(f'stream: {status}')
            if not stop.is_set():
                coach_loop(index, accounts[20][1])
        except Exception as error:
            with lock:
                errors.append(f'AI {index}: {error}')
            stop.set()

    try:
        for _ in range(120):
            try:
                if request(base, '/api/health')[0] == 200:
                    break
            except Exception:
                pass
            time.sleep(0.5)
        else:
            raise RuntimeError('backend did not become healthy')
        accounts = []
        # Register before the timed workload: one hashing operation is deliberate.
        for index in range(21):
            credentials = {'email':f'load{index}@example.com','password':'benchmark-password'}
            for attempt in range(120):
                status, signup, _ = call('/api/auth/signup', credentials)
                if status == 200:
                    accounts.append((credentials,signup['token']))
                    break
                if status != 429:
                    raise RuntimeError(f'preload signup: {status}')
                time.sleep(1)
            else:
                raise RuntimeError('account preload rate-limited for two minutes')
        started = time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=22) as pool:
            tasks = [pool.submit(player, i) for i in range(20)] + [pool.submit(ai, i) for i in range(2)]
            while time.monotonic() - started < seconds and not stop.is_set():
                sample = docker('exec', name, 'sh', '-c',
                    MEMORY_COMMAND)
                samples.append(parse_memory_sample(sample.stdout, time.monotonic() - started))
                if label == 'rust':
                    status, diagnostics, _ = call('/api/health')
                    if status == 200:
                        samples[-1]['health'] = diagnostics
                        active = diagnostics['concurrency']
                        memory = diagnostics['memory']
                        if (active['activeRequests'] > 32 or active['activeAiRequests'] > 2
                                or active['activePasswordOperations'] > 1
                                or active.get('activeGameOperations', 0) > diagnostics['limits'].get('gameOperations', 32)
                                or memory['cachePayloadBytes'] > memory['cacheBudgetBytes']):
                            raise RuntimeError('runtime diagnostics exceeded configured limits')
                time.sleep(min(5, max(0.1, seconds - (time.monotonic() - started))))
            stop.set()
            for task in tasks:
                task.result()
    except Exception as error:
        errors.append(str(error))
    finally:
        stop.set()
        state = json.loads(docker('inspect', name).stdout)[0]['State']
        if state['Running']:
            final = docker('exec', name, 'sh', '-c',
                           MEMORY_COMMAND, check=False)
            lines = final.stdout.splitlines()
            if len(lines) >= 2:
                samples.append(parse_memory_sample(final.stdout, time.monotonic() - started))
        logs = docker('logs', name, check=False)
        (output / f'{label}.log').write_text(logs.stdout + logs.stderr)
        docker('stop', name, check=False)
        docker('rm', name, check=False)
    peak = max((s['peak'] for s in samples), default=0)
    # Compare warm steady-state halves; cache growth during warmup is expected.
    steady = [s['current'] for s in samples if s['seconds'] >= seconds / 2]
    midpoint = max(1, len(steady) // 2)
    growth = ((sum(steady[midpoint:]) / max(1, len(steady[midpoint:]))) -
              (sum(steady[:midpoint]) / max(1, len(steady[:midpoint])))) if steady else 0
    minimum_duration = 3600 if profile == "soak" else 300
    minimum_samples = 700 if profile == "soak" else 54
    passed = (seconds >= minimum_duration and len(samples) >= minimum_samples and not errors and not state['OOMKilled']
              and 0 < peak < peak_limit_mib * 1024 * 1024 and growth < 5 * 1024 * 1024
              and Provider.peak == 2 and Provider.calls > 100
              and all(n >= 10 for n in activity[:20]) and min(activity[20:]) >= 100
              and not any(s['events'].get('oom_kill', 0) for s in samples))
    report = {'backend': label, 'measurementProfile': profile, 'requiredDurationSeconds': minimum_duration, 'memoryLimitMiB': memory_mib, 'peakLimitMiB': peak_limit_mib, 'durationSeconds': seconds, 'measuredElapsedSeconds': samples[-1]['seconds'] if samples else 0, 'players': 20, 'workloadCases': len(fixtures), 'peakBytes': peak if samples else None,
              'steadyGrowthBytes': growth if steady else None, 'oomKilled': state['OOMKilled'], 'errors': errors,
              'requests': counts, 'completedIterationsByWorker':activity, 'samples': samples, 'mockProviderCalls': Provider.calls,
              'peakUpstreamOperations': Provider.peak, 'accepted': passed,
              'measurement': 'cgroup v2 including SQLite and charged filesystem cache; mock remote AI'}
    (output / f'{label}.json').write_text(json.dumps(report, indent=2))
    return report


def http_smoke(base, fixtures):
    """Exercise harness requests against a disposable backend; never memory acceptance."""
    import uuid
    credentials = {'email': 'harness-' + uuid.uuid4().hex + '@example.com',
                   'password': 'benchmark-password'}
    status, account, _ = request(base, '/api/auth/signup', credentials)
    assert status == 200, ('signup', status, account)
    token = account['token']
    checked = 0
    for fixture in fixtures[:15]:
        status, game, _ = request(base, '/api/generate', {
            'problemId': fixture['id'], 'seed': fixture['seed'],
            'difficulty': fixture['difficulty'], 'forceTemplate': True}, token)
        assert status == 200, ('generate', status, game)
        for step in fixture['requests']:
            path = step['path'].replace('fixture-game', game['gameId'])
            body = dict(step['body'], gameId=game['gameId']) if 'body' in step else None
            status, value, _ = request(base, path, body, token)
            assert status == 200, (path, status, value)
            checked += 1
    status, created, _ = request(base, '/api/learning/threads', {}, token)
    assert status == 200
    path = '/api/learning/threads/' + created['thread']['id']
    message = {'requestId': 'benchmark-smoke-request', 'text': 'Explain binary search',
               'context': {'history': True}}
    status, game, _ = request(base, '/api/generate', {
        'problemId': 'binary-search', 'seed': 7, 'difficulty': 'medium', 'forceTemplate': True}, token)
    assert status == 200
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        chat = pool.submit(request, base, path + '/messages', message, token)
        coach = pool.submit(request, base, '/api/coach/ask', {
            'gameId': game['gameId'], 'message': 'What should I compare next?', 'band': 'builder'}, token)
        status, stream, _ = chat.result()
        assert status == 200 and stream['events'][-1]['type'] == 'complete'
        assert stream['events'][-1]['message']['status'] == 'complete'
        status, reply, _ = coach.result()
        assert status == 200 and reply['source'] == 'model'
    status, replay, _ = request(base, path + '/messages', message, token)
    assert status == 200 and replay['events'][-1] == stream['events'][-1]
    status, history, _ = request(base, path + '?limit=1', token=token)
    assert status == 200 and len(history['messages']) == 1
    status, _, _ = request(base, '/api/generate', token=token, raw=b' ' * (1024 * 1024 + 1))
    assert status == 413
    print(json.dumps({'httpSmoke': 'passed', 'gameResponses': checked,
                      'streamReplay': True, 'pagination': True, 'concurrentAI': True,
                      'memoryAcceptance': 'not measured'}))


def memory_rejected(report):
    """Permit the larger budget only for measured memory rejection."""
    if report['accepted']:
        return False
    if report['oomKilled']:
        return True
    # A workload error or incomplete run needs repair, not a larger budget.
    if report['errors'] or report['measuredElapsedSeconds'] < report.get('requiredDurationSeconds', 3600):
        return False
    peak = report['peakBytes']
    growth = report['steadyGrowthBytes']
    return ((peak is not None and peak >= report['peakLimitMiB'] * 2**20)
            or (growth is not None and growth >= 5 * 2**20))


def benchmark_pair(args, output, fixtures, memory_mib):
    output.mkdir(parents=True, exist_ok=True)
    # Spread all problem types through the short workload instead of spending
    # its first minutes on thirty consecutive seeds of the same problem.
    if args.profile == 'quick':
        fixtures = [case for case in fixtures if case['seed'] == 0]
    node = (run(args.node_image, 'node', args.seconds, output, fixtures, memory_mib, args.profile)
            if args.backend == 'both' else None)
    rust = run(args.rust_image, 'rust', args.seconds, output, fixtures, memory_mib, args.profile)
    comparison = {'measurementProfile': args.profile, 'nodeBaselineMeasured': node is not None,
                  'node': node['peakBytes'] if node else None, 'rust': rust['peakBytes'],
                  'rustAccepted': rust['accepted'], 'memoryLimitMiB': memory_mib,
                  'peakLimitMiB': rust['peakLimitMiB']}
    (output / 'comparison.json').write_text(json.dumps(comparison, indent=2))
    print(json.dumps(comparison), flush=True)
    return rust


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--http-smoke', metavar='DISPOSABLE_BACKEND_URL')
    parser.add_argument('--seconds', type=int, default=300)
    parser.add_argument('--profile', choices=('quick', 'soak'), default='quick')
    parser.add_argument('--backend', choices=('rust', 'both'), default='rust')
    parser.add_argument('--memory-mib', type=int, choices=(256, 512), default=256)
    parser.add_argument('--allow-512-fallback', action='store_true',
                        help='Retry measured 256 MiB memory failures at 512 MiB; retain both reports')
    parser.add_argument('--rust-image', default='dsa-rust-benchmark')
    parser.add_argument('--node-image', default='dsa-node-benchmark')
    parser.add_argument('--output', default='run/container-benchmark')
    args = parser.parse_args()
    output = ROOT / args.output
    output.mkdir(parents=True, exist_ok=True)
    fixtures = json.loads((ROOT / 'services/api-rust/tests/fixtures/game-http.json').read_text())
    if args.http_smoke:
        http_smoke(args.http_smoke, fixtures)
        return
    provider = http.server.ThreadingHTTPServer(('0.0.0.0', 18999), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    try:
        rust = benchmark_pair(args, output, fixtures, args.memory_mib)
        if args.allow_512_fallback and args.memory_mib == 256 and memory_rejected(rust):
            print('256 MiB memory acceptance failed; retrying backend-only at 512 MiB.', flush=True)
            rust = benchmark_pair(args, output / 'fallback-512', fixtures, 512)
        if not rust['accepted']:
            raise SystemExit(1)
    finally:
        provider.shutdown()


if __name__ == '__main__':
    main()
