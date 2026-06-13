#!/usr/bin/env python3
"""
claude-bridge.py — Claude CLI 订阅桥服务

让浏览器端的 web-test PoC 通过 HTTP 调用本地 `claude` CLI（用户的订阅额度），
而不需要 Anthropic API key。

启动：
    python claude-bridge.py [--port 3001]

端点：
    POST /chat
      body: {"system": "...", "prompt": "...", "model": "...(可选)"}
      returns: {"text": "...assistant 输出..."}
    GET  /health  → 200 OK

需求：`claude` CLI 在 PATH 里可调用。
"""
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = 3001
TIMEOUT = 180  # 秒；Claude CLI 处理长 prompt 可能慢
STATE_FILE = Path(__file__).parent / "state.json"  # PoC 同步状态到这里，主会话 Claude 可读


def resolve_claude_cli():
    """Windows 下 shutil.which 能找到 .CMD；但 subprocess 不带 shell 时 CreateProcess 只认 .exe。
    所以预先解析到绝对路径再传给 subprocess。"""
    p = shutil.which("claude")
    if p:
        return p
    # 兜底：常见 npm-global / yarn-global 位置
    for ext in (".cmd", ".CMD", ".bat", ".exe", ".ps1"):
        p = shutil.which("claude" + ext)
        if p:
            return p
    return None


CLAUDE_CLI_PATH = resolve_claude_cli()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # 简化日志，去 BaseHTTPRequestHandler 默认 stderr 噪音
        sys.stderr.write("[bridge] " + format % args + "\n")

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {
                "ok": True,
                "service": "claude-bridge",
                "state_file": str(STATE_FILE),
                "state_exists": STATE_FILE.exists(),
            })
        if self.path == "/state":
            # 让浏览器也能读回最近一次同步的 state（debug 用）
            if STATE_FILE.exists():
                try:
                    return self._json(200, json.loads(STATE_FILE.read_text(encoding="utf-8")))
                except Exception as e:
                    return self._json(500, {"error": f"read state failed: {e}"})
            return self._json(404, {"error": "no state synced yet"})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path == "/sync":
            return self._handle_sync()
        if self.path != "/chat":
            return self._json(404, {"error": "not found"})

        length = int(self.headers.get("Content-Length") or 0)
        try:
            raw = self.rfile.read(length).decode("utf-8")
            body = json.loads(raw)
            system = body.get("system", "")
            prompt = body.get("prompt", "")
            model = body.get("model", "")
            if not prompt:
                return self._json(400, {"error": "missing prompt"})

            full_prompt = (system + "\n\n---\n\n" + prompt) if system else prompt

            if not CLAUDE_CLI_PATH:
                return self._json(500, {"error": "`claude` CLI not in PATH (启动时未解析到)"})

            # 注意：不把 prompt 作为命令行参数（Windows 命令行 8191 字符限制会爆）
            # 改为通过 stdin pipe 喂给 `claude -p`
            cmd = [CLAUDE_CLI_PATH, "-p"]
            if model:
                cmd.extend(["--model", model])

            # Windows .CMD 仍需 shell=True
            use_shell = os.name == "nt" and CLAUDE_CLI_PATH.lower().endswith((".cmd", ".bat"))

            result = subprocess.run(
                cmd,
                input=full_prompt.encode("utf-8"),
                capture_output=True,
                timeout=TIMEOUT,
                shell=use_shell,
            )
            stdout = result.stdout.decode("utf-8", errors="replace")
            # Windows CMD 错误输出可能是 GBK；先试 UTF-8，失败回退 GBK
            try:
                stderr = result.stderr.decode("utf-8")
            except UnicodeDecodeError:
                stderr = result.stderr.decode("gbk", errors="replace")

            if result.returncode != 0:
                return self._json(500, {
                    "error": f"claude CLI exit {result.returncode}",
                    "stderr": stderr[:1000],
                })

            return self._json(200, {"text": stdout, "stderr_preview": stderr[:200]})

        except subprocess.TimeoutExpired:
            self._json(504, {"error": f"claude CLI timeout > {TIMEOUT}s"})
        except json.JSONDecodeError as e:
            self._json(400, {"error": f"invalid JSON body: {e}"})
        except FileNotFoundError:
            self._json(500, {"error": "`claude` CLI not in PATH"})
        except Exception as e:
            self._json(500, {"error": str(e)})

    def _handle_sync(self):
        """接收 PoC 的全量状态 dump，写到 state.json 让主会话 Claude 可读"""
        length = int(self.headers.get("Content-Length") or 0)
        try:
            raw = self.rfile.read(length).decode("utf-8")
            payload = json.loads(raw)
            payload["__synced_at"] = datetime.now().isoformat(timespec="seconds")
            STATE_FILE.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            counts = {}
            for layer, items in (payload.get("layers") or {}).items():
                counts[layer] = len(items) if isinstance(items, list) else 0
            return self._json(200, {"ok": True, "counts": counts, "path": str(STATE_FILE)})
        except json.JSONDecodeError as e:
            self._json(400, {"error": f"invalid JSON: {e}"})
        except Exception as e:
            self._json(500, {"error": str(e)})


def main():
    port = PORT
    if "--port" in sys.argv:
        port = int(sys.argv[sys.argv.index("--port") + 1])
    print(f"claude-bridge listening on http://localhost:{port}")
    print(f"  claude CLI:  {CLAUDE_CLI_PATH or '!!NOT FOUND IN PATH!!'}")
    print(f"  POST /chat    body: {{\"system\":\"...\", \"prompt\":\"...\"}}")
    print(f"  POST /sync    body: 全量 state JSON  → 写到 {STATE_FILE}")
    print(f"  GET  /state   读回 state.json")
    print(f"  GET  /health")
    print(f"  Ctrl-C to stop")
    HTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    main()
