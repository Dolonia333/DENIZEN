#!/usr/bin/env python3
"""Query LM Studio and return a JSON summary of loaded models,
their actual context lengths, and mismatches against openclaw.json."""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error

DEFAULT_CONFIG = os.path.join(os.path.expanduser("~"), ".denizen", "jelly.json")
TIMEOUT = 5


def eprint(msg):
    print(msg, file=sys.stderr)


def load_config(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def derive_lms_root(base_url):
    url = base_url.rstrip("/")
    if url.endswith("/v1"):
        url = url[:-3]
    return url


def http_get_json(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser(description="LM Studio status and model summary")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Path to openclaw.json")
    args = parser.parse_args()

    try:
        config = load_config(args.config)
    except Exception as exc:
        eprint(f"Failed to read config: {exc}")
        return 1

    openai_provider = config.get("models", {}).get("providers", {}).get("openai", {})
    base_url = openai_provider.get("baseUrl", "")
    if not base_url:
        eprint("No models.providers.openai.baseUrl found in config")
        return 1

    lms_root = derive_lms_root(base_url)

    config_models = {}
    for m in openai_provider.get("models", []):
        mid = m.get("id", "")
        if mid:
            config_models[mid] = m.get("contextWindow")

    result = {
        "lmsRoot": lms_root,
        "baseUrl": base_url,
        "models": [],
        "mismatches": [],
    }

    # List models via /api/v0/models (detailed endpoint with state and context info)
    try:
        models_resp = http_get_json(f"{lms_root}/api/v0/models")
        model_data = models_resp.get("data", [])
    except urllib.error.URLError as exc:
        result["error"] = f"Unreachable: {exc.reason}"
        eprint(f"LM Studio unreachable at {lms_root}: {exc.reason}")
        print(json.dumps(result, indent=2))
        return 2
    except Exception as exc:
        result["error"] = str(exc)
        eprint(f"LM Studio error: {exc}")
        print(json.dumps(result, indent=2))
        return 2

    for m in model_data:
        model_id = m.get("id", "unknown")
        state = m.get("state", "unknown")
        max_ctx = m.get("max_context_length")
        loaded_ctx = m.get("loaded_context_length")
        cfg_ctx = config_models.get(model_id)

        entry = {
            "id": model_id,
            "state": state,
            "max_context_length": max_ctx,
            "loaded_context_length": loaded_ctx,
            "config_context_window": cfg_ctx,
        }
        result["models"].append(entry)

        # Flag mismatch: config says one thing, LM Studio loaded with another
        if state == "loaded" and loaded_ctx and cfg_ctx and loaded_ctx != cfg_ctx:
            result["mismatches"].append({
                "model": model_id,
                "loaded_context": loaded_ctx,
                "config_context": cfg_ctx,
            })
        # Also flag if config contextWindow exceeds model's max
        if cfg_ctx and max_ctx and cfg_ctx > max_ctx:
            result["mismatches"].append({
                "model": model_id,
                "issue": "config_exceeds_max",
                "config_context": cfg_ctx,
                "max_context": max_ctx,
            })

    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
