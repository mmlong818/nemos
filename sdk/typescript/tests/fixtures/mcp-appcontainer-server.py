import json
import os
import socket
import subprocess
import sys


def probe(arguments):
    result = {
        "allowed_read": False,
        "denied_read": False,
        "allowed_write": False,
        "denied_write": False,
        "denied_network": False,
        "denied_loopback": False,
        "denied_child_process": False,
    }

    try:
        with open(arguments["allowedRead"], "r", encoding="utf-8") as handle:
            result["allowed_read"] = bool(handle.read())
    except Exception:
        pass

    try:
        with open(arguments["deniedRead"], "r", encoding="utf-8"):
            pass
    except PermissionError:
        result["denied_read"] = True
    except OSError as error:
        result["denied_read"] = getattr(error, "winerror", None) == 5

    allowed_output = os.path.join(arguments["allowedWriteDir"], "allowed-output.txt")
    try:
        with open(allowed_output, "w", encoding="utf-8") as handle:
            handle.write("allowed")
        result["allowed_write"] = True
    except Exception:
        pass

    denied_output = os.path.join(arguments["deniedWriteDir"], "denied-output.txt")
    try:
        with open(denied_output, "w", encoding="utf-8") as handle:
            handle.write("unexpected")
    except PermissionError:
        result["denied_write"] = True
    except OSError as error:
        result["denied_write"] = getattr(error, "winerror", None) == 5

    try:
        connection = socket.create_connection(("1.1.1.1", 80), timeout=1)
        connection.close()
    except PermissionError:
        result["denied_network"] = True
    except OSError as error:
        result["denied_network"] = getattr(error, "winerror", None) == 10013
    try:
        connection = socket.create_connection(
            ("127.0.0.1", int(arguments["localProbePort"])),
            timeout=1,
        )
        connection.close()
    except PermissionError:
        result["denied_loopback"] = True
    except OSError as error:
        result["denied_loopback"] = getattr(error, "winerror", None) == 10013

    try:
        completed = subprocess.run(
            [sys.executable, "-c", "print('unexpected')"],
            capture_output=True,
            timeout=2,
            check=False,
        )
        result["denied_child_process"] = completed.returncode != 0
    except (PermissionError, OSError, subprocess.SubprocessError):
        result["denied_child_process"] = True

    return result


def send(message):
    sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
    sys.stdout.flush()


for raw_line in sys.stdin:
    try:
        request = json.loads(raw_line)
        method = request.get("method")
        request_id = request.get("id")
        if method == "initialize":
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "protocolVersion": request.get("params", {}).get("protocolVersion", "2025-11-25"),
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "nemos-appcontainer-test", "version": "1.0.0"},
                },
            })
        elif method == "tools/list":
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "tools": [{
                        "name": "sandbox_probe",
                        "description": "Probe Windows AppContainer restrictions",
                        "inputSchema": {
                            "type": "object",
                            "properties": {
                                "allowedRead": {"type": "string"},
                                "deniedRead": {"type": "string"},
                                "allowedWriteDir": {"type": "string"},
                                "deniedWriteDir": {"type": "string"},
                                "localProbePort": {"type": "number"},
                            },
                            "required": [
                                "allowedRead",
                                "deniedRead",
                                "allowedWriteDir",
                                "deniedWriteDir",
                                "localProbePort",
                            ],
                        },
                    }],
                },
            })
        elif method == "tools/call":
            arguments = request.get("params", {}).get("arguments", {})
            data = probe(arguments)
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "result": {
                    "content": [{
                        "type": "text",
                        "text": json.dumps(data, separators=(",", ":")),
                    }],
                },
            })
        elif request_id is not None:
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32601, "message": "Method not found"},
            })
    except Exception as error:
        request_id = request.get("id") if isinstance(locals().get("request"), dict) else None
        if request_id is not None:
            send({
                "jsonrpc": "2.0",
                "id": request_id,
                "error": {"code": -32000, "message": str(error)},
            })