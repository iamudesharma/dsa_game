"""Compare the implemented auth preview against Node on disposable databases.

Run after `cargo build --release --manifest-path services/api-rust/Cargo.toml`:
    python3 scripts/rust-auth-smoke.py
This does not measure the full game/chat workload or certify the RAM target.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent.parent


def port():
    with socket.socket() as connection:
        connection.bind(("127.0.0.1", 0))
        return connection.getsockname()[1]


def request(base, route, method="GET", body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + route, data=data, headers=headers, method=method)
    try:
        response = urllib.request.urlopen(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        return response.status, json.load(response), dict(response.headers)


def exercise(command, env, directory):
    service_port = port()
    env = dict(env, PORT=str(service_port), API_HOST="127.0.0.1", DSA_DB_PATH=str(directory / "db.sqlite"))
    base = f"http://127.0.0.1:{service_port}"
    with open(directory / "server.log", "wb") as log:
        process = subprocess.Popen(command, cwd=ROOT / "services/api", env=env, stdout=log, stderr=log)
        try:
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError((directory / "server.log").read_text())
                try:
                    with socket.create_connection(("127.0.0.1", service_port), timeout=0.1):
                        break
                except OSError:
                    time.sleep(0.1)
            else:
                raise RuntimeError("server startup timed out")
            samples = []
            for _ in range(10):
                # macOS/Linux ps RSS is KiB. Sampling idle auth-only preview.
                samples.append(int(subprocess.check_output(["ps", "-o", "rss=", "-p", str(process.pid)], text=True).strip()))
                time.sleep(0.05)
            credentials = {"email": " Smoke@Example.com ", "password": "password123"}
            status, signup, headers = request(base, "/api/auth/signup", "POST", credentials)
            assert status == 200, (status, signup)
            assert "HttpOnly" in next(v for k, v in headers.items() if k.lower() == "set-cookie")
            token = signup["token"]
            status, me, _ = request(base, "/api/auth/me", token=token)
            assert status == 200
            duplicate = request(base, "/api/auth/signup", "POST", credentials)[:2]
            invalid = request(base, "/api/auth/login", "POST", dict(credentials, password="wrongpassword"))[:2]
            status, login, _ = request(base, "/api/auth/login", "POST", credentials)
            assert status == 200 and login["user"] == signup["user"]
            assert request(base, "/api/auth/logout", "POST", {}, token)[0] == 200
            revoked = request(base, "/api/auth/me", token=token)[:2]
            me["user"]["id"] = "<id>"
            return {"me": me, "duplicate": duplicate, "invalid": invalid, "revoked": revoked}, {
                "idleRssKiBMin": min(samples), "idleRssKiBMax": max(samples),
                "measurement": "local ps sampling before auth; not cgroup, load, or peak-memory acceptance",
            }
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    env = dict(os.environ, OPENCODE_GO_ENABLED="0", OPENCODE_ENABLED="0", LOCAL_LLM_ENABLED="0", LAYA_ENABLED="0", OPENROUTER_API_KEY="")
    binary = ROOT / "services/api-rust/target/release/dsa-api"
    if not binary.exists():
        raise SystemExit("Build the Rust release binary first.")
    with tempfile.TemporaryDirectory(prefix="dsa-auth-parity-") as temp:
        directory = Path(temp)
        node_dir, rust_dir = directory / "node", directory / "rust"
        node_dir.mkdir(); rust_dir.mkdir()
        node_contract, node_memory = exercise(["node", "--import=tsx", "src/index.ts"], env, node_dir)
        rust_contract, rust_memory = exercise([str(binary)], env, rust_dir)
        assert node_contract == rust_contract, json.dumps({"node": node_contract, "rust": rust_contract}, indent=2)
        report = {"authParity": "passed", "node": node_memory, "rustPreview": rust_memory, "fullMigrationAccepted": False}
        output = ROOT / "run/rust-reference/auth-smoke.json"
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
