"""Cross-platform task runner: python tasks.py setup | data | dev | test."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"


def tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        sys.exit(f"`{name}` not found on PATH; see README.md prerequisites")
    return path


def run(args: list[str], cwd: Path) -> None:
    subprocess.run(args, cwd=cwd, check=True)


def setup() -> None:
    run([tool("uv"), "sync"], BACKEND)
    if FRONTEND.exists():
        run([tool("npm"), "install"], FRONTEND)


def data() -> None:
    run([tool("uv"), "run", "python", "-m", "pipeline.build"], BACKEND)


def test() -> None:
    run([tool("uv"), "run", "pytest", "-q"], BACKEND)


def dev() -> None:
    procs = [
        subprocess.Popen(
            [tool("uv"), "run", "uvicorn", "app.main:app", "--reload", "--port", "8000"], cwd=BACKEND
        ),
    ]
    if FRONTEND.exists():
        procs.append(subprocess.Popen([tool("npm"), "run", "dev"], cwd=FRONTEND))
    print("backend  http://localhost:8000/docs\nfrontend http://localhost:5173")
    try:
        for p in procs:
            p.wait()
    except KeyboardInterrupt:
        pass
    finally:
        for p in procs:
            p.terminate()


TASKS = {"setup": setup, "data": data, "dev": dev, "test": test}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in TASKS:
        sys.exit(f"usage: python tasks.py {{{'|'.join(TASKS)}}}")
    TASKS[sys.argv[1]]()
