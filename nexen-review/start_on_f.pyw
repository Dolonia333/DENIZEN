"""Fixed NEXEN launcher. Task data, logs, downloads and caches stay on F:."""
import os
import runpy
import sys
from pathlib import Path

sys.dont_write_bytecode = True
BASE = Path(__file__).resolve().parent
if str(BASE).lower() != r"f:\nexen_game\nexen_autonomy_v0.1":
    raise RuntimeError("Unexpected NEXEN launch directory")
sys.path.insert(0, str(BASE))
from storage_policy import require_output_path
require_output_path(BASE)
CACHE = Path(r"F:\NEXEN_CACHE")
for name, child in {
    "TEMP": "temp", "TMP": "temp", "TMPDIR": "temp",
    "PIP_CACHE_DIR": "pip", "UV_CACHE_DIR": "uv", "npm_config_cache": "npm",
    "XDG_CACHE_HOME": "xdg", "HF_HOME": "huggingface",
    "TORCH_HOME": "torch", "PLAYWRIGHT_BROWSERS_PATH": "playwright",
}.items():
    path = require_output_path(CACHE / child, within=CACHE)
    path.mkdir(parents=True, exist_ok=True)
    os.environ[name] = str(path)
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
sys.dont_write_bytecode = True
os.chdir(BASE)
sys.argv = [str(BASE / "local_watchdog.py")]
runpy.run_path(str(BASE / "local_watchdog.py"), run_name="__main__")
