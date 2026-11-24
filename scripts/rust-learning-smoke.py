"""Differential Node/Rust learning tests on copies of one legacy SQLite fixture.
Run after the Rust release build: python3 scripts/rust-learning-smoke.py
No real account database, paid provider, or running user server is touched.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import runpy
import socket
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
HELPERS = runpy.run_path(str(ROOT / "scripts/rust-auth-smoke.py"))
request, port = HELPERS["request"], HELPERS["port"]
ENV = dict(os.environ, OPENCODE_GO_ENABLED="0", OPENCODE_ENABLED="0", LOCAL_LLM_ENABLED="0", LAYA_ENABLED="0", OPENROUTER_API_KEY="")


@contextmanager
def server(command, database, directory):
    number = port()
    env = dict(ENV, PORT=str(number), API_HOST="127.0.0.1", DSA_DB_PATH=str(database))
    with open(directory / "server.log", "wb") as log:
        child = subprocess.Popen(command, cwd=ROOT / "services/api", env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if child.poll() is not None:
                    raise RuntimeError((directory / "server.log").read_text())
                try:
                    with socket.create_connection(("127.0.0.1", number), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("startup timed out")
            yield f"http://127.0.0.1:{number}"
        finally:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait()


def seed(database, directory):
    with server(["node", "--import=tsx", "src/index.ts"], database, directory) as base:
        accounts = []
        for email in ["alice@example.com", "bob@example.com"]:
            status, account, _ = request(base, "/api/auth/signup", "POST", {"email": email, "password": "password123"})
            assert status == 200
            accounts.append(account)
        token = accounts[0]["token"]
        games, threads = [], []
        for i in range(3):
            status, game, _ = request(base, "/api/generate", "POST", {"problemId": "binary-search" if i % 2 == 0 else "two-sum", "seed": i+1, "difficulty": "easy", "forceTemplate": True}, token)
            assert status == 200, game
            games.append(game["gameId"])
            status, thread, _ = request(base, "/api/learning/threads", "POST", {}, token)
            assert status == 200
            threads.append(thread["thread"]["id"])
    with sqlite3.connect(database) as db:
        for i in range(8):
            message = {"id": f"msg-{i}", "role": "assistant", "text": "binary search explanation", "status": "streaming" if i == 7 else "complete", "createdAt": i, "requestId": f"request-{i}"}
            db.execute("INSERT INTO learning_messages VALUES(?,?,?,?)", (message["id"], threads[0], message["requestId"], json.dumps(message)))
        for i in range(70):
            db.execute("INSERT INTO study_plans VALUES(?,?,?,?,?,1)", (f"plan-{70-i:03}", accounts[0]["user"]["id"], f"plan-request-{i}", f"Plan {i}", "Content"))
        db.execute("INSERT INTO learning_actions VALUES('pending',?,'running',NULL,NULL)", (accounts[0]["user"]["id"],))
        for index in [0, 2]:
            row = json.loads(db.execute("SELECT record_json FROM practice_runs WHERE game_id=?", (games[index],)).fetchone()[0])
            row.update(completedAt=1767225600000+index*86400000, outcome="won", mistakes=0, hints=index)
            db.execute("UPDATE practice_runs SET record_json=? WHERE game_id=?", (json.dumps(row), games[index]))
    return accounts, games, threads


def normalize(value):
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        # Recovery intentionally refreshes thread.updatedAt at service startup.
        is_thread = "title" in value and "createdAt" in value and "updatedAt" in value
        is_kit = "kitId" in value and "createdAt" in value
        return {key: "<recovery-time>" if is_thread and key == "updatedAt" else "<kit-time>" if is_kit and key == "createdAt" else "<kit-id>" if key == "kitId" else (item.split(":")[0]+":fixture") if key in ["id","sourceRef"] and isinstance(item,str) and item.split(":")[0] in ["exp","edu","proj","skill"] else normalize(item) for key, item in value.items()}
    return value


def exercise(base, accounts, games, threads):
    alice, bob = accounts[0]["token"], accounts[1]["token"]
    results = []

    def call(path, method="GET", body=None, token=alice):
        status, data, _ = request(base, path, method, body, token)
        results.append({"path": "/api/interview/kits/<kit-id>" if path.startswith("/api/interview/kits/") and path!="/api/interview/kits/unknown" else path, "method": method, "status": status, "body": normalize(data)})
        return data

    def malformed(token):
        headers={"Content-Type":"application/json"}
        if token: headers["Authorization"]="Bearer " + token
        req=urllib.request.Request(base+"/api/me/resume",data=b"not-json",headers=headers,method="PUT")
        try: response=urllib.request.urlopen(req,timeout=10)
        except urllib.error.HTTPError as error: response=error
        with response:
            results.append({"path":"/api/me/resume:malformed","method":"PUT","status":response.status,"body":json.load(response)})
    malformed(None)
    malformed(alice)
    call("/api/me/resume", token=None)
    call("/api/me/resume")
    call("/api/me/resume", "PUT", {"summary":"Backend engineer","skills":[{"id":"rust","name":"Rust"}]})
    call("/api/me/resume")
    call("/api/me/resume", token=bob)
    call("/api/me/resume", "PUT", {"extra":True})
    call("/api/me/resume", "PUT", {"contact":{"name":"😀"*61}})
    call("/api/me/resume", "PUT", {"contact":{"name":"😀"*121}})
    call("/api/me/resume", "PUT", {"skills":[{"id":"x","name":"Rust","years":51}]})
    call("/api/interview/generate", "POST", {"seed":7}, token=None)
    call("/api/interview/generate", "POST", {"seed":7}, token=bob)
    call("/api/me/parse-resume", "POST", {"text":"Summary: Engineer\nSkills: Rust, SQL","save":False})
    call("/api/me/parse-resume", "POST", {"text":"Experience\nEngineer at Northwind Labs 2019 - Present\n- Built cache\nSkills: Rust","save":True})
    call("/api/me/parse-resume", "POST", {})
    call("/api/me/target")
    call("/api/me/target", "PUT", {"goal":"Build systems","companyId":"custom"})
    call("/api/me/target")
    generated=call("/api/interview/generate", "POST", {"seed":7})
    call("/api/interview/kits/"+generated["kitId"])
    call("/api/interview/kits/"+generated["kitId"], token=bob)
    call("/api/interview/generate", "POST", {"seed":7,"newAngle":True})
    call("/api/interview/generate", "POST", {"seed":0,"target":{"goal":"Prepare","companyId":"ai-lab"}})
    call("/api/me/target", "PUT", {"goal":"Build systems"})
    call("/api/me/target", "PUT", {"goal":"","companyId":"","seniority":"invalid","unknown":True})
    call("/api/me/progress", "POST", {"completed":{"binary-search":"2026-01-01T00:00:00.000Z","invalid":"2026-01-01","two-sum":"bad"}})
    call("/api/me/progress", "POST", {"completed":{"binary-search":"2026-02-01","two-sum":"2026-01-03"}})
    call("/api/me/progress", "POST", {"completed":{"x"*81:"2026-01-01"}})
    call("/api/me/progress", "POST", {"completed":{"":"2026-01-01"}})
    call("/api/me/progress")
    call("/api/me/progress", token=bob)
    call("/api/auth/me")
    call("/api/interview/kits")
    call("/api/interview/kits/unknown")
    call("/api/lessons", token=None)
    call("/api/companies", token=None)
    call("/api/learning/dashboard", token=None)
    call("/api/learning/dashboard")
    call("/api/learning/dashboard", token=bob)
    page = call("/api/learning/threads?limit=1")
    call("/api/learning/threads?limit=1&cursor=" + page["nextCursor"])
    call("/api/learning/threads?q=binary%20search")
    call("/api/learning/threads?cursor=unknown&limit=2")
    path = "/api/learning/threads/" + threads[0]
    page = call(path + "?limit=3")
    call(path + "?limit=3&cursor=" + page["nextCursor"])
    call(path + "?limit=%200x3%20&cursor=" + page["nextCursor"] + "!!")
    call(path, token=bob)
    call(path, "PUT", {"title": " "})
    call(path, "PUT", {"title": "  Saved conversation  "})
    call(path, "PUT", {"title": "Other account"}, bob)
    call("/api/learning/plans")
    call("/api/learning/plans", token=bob)
    history = call("/api/learning/history?topic=binary-search&limit=1")
    call("/api/learning/history?topic=binary-search&limit=1&cursor=" + history["nextCursor"])
    call("/api/learning/history?from=0&to=1")
    call("/api/learning/history?topic=unknown")
    call("/api/learning/history", token=bob)
    run = "/api/learning/history/" + games[0]
    call(run)
    call(run, token=bob)
    call(run + "/reflection", "POST", {})
    call(run + "/reflection", "POST", {"retention": "Learned", "integration": "Use later", "skipped": False})
    call(run + "/reflection", "POST", {"retention": "Learned", "integration": "Use later", "skipped": False}, bob)
    call(path, "DELETE", token=bob)
    call(path, "DELETE")
    call(path)
    # Generated ids/timestamps differ by design: compare the stable create shape.
    created = call("/api/learning/threads", "POST", {})
    results[-1]["body"]["thread"]["id"] = "<new-thread>"
    results[-1]["body"]["thread"]["createdAt"] = "<creation-time>"
    assert created["thread"]["title"] == "New conversation"
    return results


if __name__ == "__main__":
    binary = ROOT / "services/api-rust/target/release/dsa-api"
    if not binary.exists():
        raise SystemExit("Build the Rust release binary first.")
    with tempfile.TemporaryDirectory(prefix="dsa-learning-parity-") as temp:
        directory = Path(temp)
        legacy = directory / "legacy.sqlite"
        accounts, games, threads = seed(legacy, directory)
        reports = {}
        for runtime, command in [("node", ["node", "--import=tsx", "src/index.ts"]), ("rust", [str(binary)])]:
            destination = directory / f"{runtime}.sqlite"
            with sqlite3.connect(legacy) as source, sqlite3.connect(destination) as target:
                source.backup(target)
            with server(command, destination, directory) as base:
                reports[runtime] = exercise(base, accounts, games, threads)
        for node, rust in zip(reports["node"], reports["rust"]):
            assert node == rust, json.dumps({"node": node, "rust": rust}, indent=2)
        assert len(reports["node"]) == len(reports["rust"])
        output = ROOT / "run/rust-reference/learning-smoke.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps({"learningParity": "passed", "requestsCompared": len(reports["node"]), "fullMigrationAccepted": False}, indent=2) + "\n")
        print(output.read_text())
