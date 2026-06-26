"""mem0 external-baseline adapter for MnemoBench.

Reads data/<task>.jsonl, runs each item through mem0 (same models as Nemos:
gpt-4o + text-embedding-3-small), dumps retrieved memory sets to
results/<task>-mem0-retrieved.json. Scoring is done by the shared JS judge
(score-external.mjs) so mem0 and Nemos are scored identically.

Proxy: Python httpx honors HTTPS_PROXY via trust_env, so no extra setup.
Usage: python src/adapters/mem0_run.py --task BUC --n 50
"""
import os, sys, json, argparse
os.environ["ANONYMIZED_TELEMETRY"] = "False"
os.environ.setdefault("MEM0_TELEMETRY", "False")

from mem0 import Memory

CFG = {
    "llm": {"provider": "openai", "config": {"model": "gpt-4o", "temperature": 0}},
    "embedder": {"provider": "openai", "config": {"model": "text-embedding-3-small"}},
}

def load_items(task, n):
    path = os.path.join(os.path.dirname(__file__), "..", "..", "data", f"{task.lower()}.jsonl")
    items = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                items.append(json.loads(line))
    return items[:n]

def retrieved_texts(r):
    res = r.get("results", r) if isinstance(r, dict) else r
    out = []
    for it in res:
        out.append(it.get("memory") if isinstance(it, dict) else str(it))
    return out

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--task", default="BUC")
    ap.add_argument("--n", type=int, default=50)
    args = ap.parse_args()

    items = load_items(args.task, args.n)
    mem = Memory.from_config(CFG)
    out = []
    for idx, item in enumerate(items):
        uid = item["id"]
        # BUC/FOR: all user sessions. ASP: mem0 has no persona namespace -> shared store (the naive baseline).
        for s in item.get("sessions", []):
            if args.task.upper() == "ASP" or s.get("speaker") == "user":
                try:
                    mem.add(s["text"], user_id=uid)
                except Exception as e:
                    print(f"  add fail {uid}: {e}", file=sys.stderr)
        probes_out = []
        for p in item.get("probes", []):
            try:
                r = mem.search(p["query"], filters={"user_id": uid}, limit=10)
                ret = retrieved_texts(r)
            except Exception as e:
                print(f"  search fail {uid}: {e}", file=sys.stderr)
                ret = []
            probes_out.append({
                "query": p["query"], "expected": p.get("expected", []),
                "forbidden": p.get("forbidden", []), "kind": p.get("kind"),
                "retrieved": ret,
            })
        out.append({"id": uid, "task": item["task"], "probes": probes_out})
        print(f"[{idx+1}/{len(items)}] {uid}: {sum(len(x['retrieved']) for x in probes_out)} retrieved", flush=True)

    res_dir = os.path.join(os.path.dirname(__file__), "..", "..", "results")
    os.makedirs(res_dir, exist_ok=True)
    out_path = os.path.join(res_dir, f"{args.task.lower()}-mem0-retrieved.json")
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("wrote", out_path)

if __name__ == "__main__":
    main()
