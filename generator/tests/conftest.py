from __future__ import annotations

import os
import shutil
from pathlib import Path
from urllib.parse import urlparse

import pytest

from fakes import LOCAL_DB, FakeBackup, FakeStore, FakeVoice, make_book, make_mp3, mk_settings
from hearthread.db import Db
from hearthread.deps import Deps


@pytest.fixture(scope="session")
def clip(tmp_path_factory) -> Path:
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg not installed")
    p = tmp_path_factory.mktemp("clip") / "clip.mp3"
    make_mp3(p)
    return p


@pytest.fixture(scope="session")
def _db_url() -> str:
    url = os.environ.get("TEST_DATABASE_URL", LOCAL_DB)
    host = urlparse(url).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        pytest.exit(f"refusing to run tests against non-local database host {host!r}", returncode=2)
    return url


@pytest.fixture
def db(_db_url):
    """A clean local database. Skipped (with the reason) until the migrations are applied."""
    d = Db(_db_url)
    try:
        has = d.one("SELECT to_regclass('public.jobs') IS NOT NULL AS ok")["ok"]
    except Exception as exc:  # noqa: BLE001
        d.close()
        pytest.skip(
            f"local Supabase database not reachable ({type(exc).__name__}); run `supabase start`"
        )
    if not has:
        d.close()
        pytest.skip(
            "tables missing: supabase/migrations are not applied yet (run `supabase db reset`)"
        )
    d.x("TRUNCATE jobs, chapters, books, members CASCADE")
    d.x("DELETE FROM auth.users WHERE email LIKE %s", ("%@test.invalid",))
    yield d
    d.x("TRUNCATE jobs, chapters, books, members CASCADE")  # leave the shared local DB empty
    d.x("DELETE FROM auth.users WHERE email LIKE %s", ("%@test.invalid",))
    d.close()


@pytest.fixture
def deps(db, clip, tmp_path) -> Deps:
    return Deps(
        settings=mk_settings(),
        db=db,
        store=FakeStore(),
        backup=FakeBackup(),
        voice=FakeVoice(clip),
        tmp_base=tmp_path / "tmp",
        state_dir=tmp_path / "state",
        parse=lambda _path: make_book(),
    )


@pytest.fixture
def epub(tmp_path) -> Path:
    p = tmp_path / "invented.epub"
    p.write_bytes(b"not a real epub; the fake parser ignores it")
    return p
