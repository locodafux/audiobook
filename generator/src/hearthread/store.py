"""The Mac's own copy of everything the generator makes: EPUB sources, covers, chapter audio and timings.

Telegram is where phones fetch audio from, but it may delete files, so this folder is the real
backup (and the source `backup` jobs and `regen` read from). Deterministic keys make a retried
write overwrite safely.
"""

from __future__ import annotations

import hashlib
import os
import shutil
from pathlib import Path
from typing import Protocol


class Store(Protocol):
    def put_file(self, key: str, path: Path, content_type: str) -> str: ...
    def put_bytes(self, key: str, data: bytes, content_type: str) -> str: ...
    def head(self, key: str) -> dict | None: ...
    def get_file(self, key: str, dest: Path) -> None: ...
    def delete_prefix(self, prefix: str) -> int: ...
    def check(self) -> None: ...


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class LocalStore:
    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if not p.is_relative_to(self.root.resolve()):
            raise ValueError(f"key {key!r} points outside the library folder")
        return p

    def check(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        probe = self.root / ".write-test"
        probe.write_bytes(b"ok")
        probe.unlink()

    def head(self, key: str) -> dict | None:
        """{'size': int, 'sha256': None} or None when the file does not exist."""
        p = self._path(key)
        return {"size": p.stat().st_size, "sha256": None} if p.is_file() else None

    def put_file(self, key: str, path: Path, content_type: str) -> str:
        """Copy in, then verify the size. Returns the sha256."""
        sha = sha256_file(path)
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        shutil.copyfile(path, part)
        os.replace(part, dest)
        if dest.stat().st_size != path.stat().st_size:
            raise RuntimeError(f"copy of {key} did not verify")
        return sha

    def put_bytes(self, key: str, data: bytes, content_type: str) -> str:
        dest = self._path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        part = dest.with_name(dest.name + ".part")
        part.write_bytes(data)
        os.replace(part, dest)
        return hashlib.sha256(data).hexdigest()

    def get_file(self, key: str, dest: Path) -> None:
        shutil.copyfile(self._path(key), dest)

    def delete_prefix(self, prefix: str) -> int:
        base = self._path(prefix.rpartition("/")[0] or ".")
        n = 0
        if base.is_dir():
            for p in sorted(base.rglob("*")):
                if p.is_file() and p.relative_to(self.root.resolve()).as_posix().startswith(prefix):
                    p.unlink()
                    n += 1
        return n
