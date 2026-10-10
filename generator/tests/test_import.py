"""import-voiced: old folder of chapter_NN.mp3 + chapter_NN_timing.json into the library, Telegram and DB."""

from __future__ import annotations

import json
import shutil
import uuid

import pytest

from fakes import FakeBackup
from hearthread import importer
from hearthread.library import CommandError

OLD = [
    {"index": 0, "text": "A first sentence.", "startTime": 0.0, "endTime": 1.5, "paragraphId": 0},
    {"index": 1, "text": "A second one.", "startTime": 1.5, "endTime": 3.0, "paragraphId": 1},
]


@pytest.fixture
def voiced(tmp_path, clip):
    d = tmp_path / "old-volume"
    d.mkdir()
    for n in (1, 2, 3):
        shutil.copy(clip, d / f"chapter_{n:02d}.mp3")
        (d / f"chapter_{n:02d}_timing.json").write_text(json.dumps(OLD))
    (d / "notes.txt").write_text("ignored")
    return d


@pytest.fixture
def captain(db):
    uid = str(uuid.uuid4())
    db.x("INSERT INTO auth.users (id, email) VALUES (%s, 'cap@test.invalid')", (uid,))
    db.x(
        """INSERT INTO members (user_id, email, display_name, username, status)
           VALUES (%s, 'cap@test.invalid', 'C', 'capn', 'active')""",
        (uid,),
    )
    return uid


def run(deps, folder, **kw):
    return importer.import_voiced(deps, folder, "old-vol", "Old Volume", say=lambda _m: None, **kw)


def test_timing_conversion_matches_the_new_format():
    assert importer.convert_timing(OLD) == {
        "v": 1,
        "sentences": [
            {"i": 0, "t": "A first sentence.", "s": 0.0, "e": 1.5},
            {"i": 1, "t": "A second one.", "s": 1.5, "e": 3.0},
        ],
    }
    for bad in (None, [], {"a": 1}, [{"text": "x"}]):
        with pytest.raises(ValueError):
            importer.convert_timing(bad)


def test_import_stores_every_chapter_in_library_and_telegram_and_publishes_privately(
    deps, voiced, captain
):
    assert run(deps, voiced, private_to="CAP@test.invalid", first_chapter=96, series="S", volume=2)
    book = deps.db.one("SELECT * FROM books")
    assert (book["status"], str(book["private_to"]), book["chapter_count"]) == (
        "published",
        captain,
        3,
    )
    assert (book["series_title"], book["volume"]) == ("S", 2)
    ch = {c["n"]: c for c in deps.db.q("SELECT * FROM chapters ORDER BY n")}
    assert [c["title"] for c in ch.values()] == ["Chapter 96", "Chapter 97", "Chapter 98"]
    for c in ch.values():
        assert c["status"] == "ready" and c["sentence_count"] == 2 and c["duration_s"] > 0
        assert c["telegram_audio_file_id"] and c["telegram_timing_file_id"]
        assert deps.store.head(c["audio_key"])["size"] == c["bytes"]  # library copy exists
        assert (
            json.loads(deps.store.objects[c["timing_key"]][0])["v"] == 1
        )  # converted, not copied raw
    assert len(deps.backup.sent) == 6  # audio + timing per chapter
    assert (voiced / "chapter_01.mp3").exists()  # the originals are untouched


def test_import_is_resumable_and_does_not_upload_twice(deps, voiced, captain):
    assert run(deps, voiced, private_to="cap@test.invalid", limit=2)
    assert deps.db.one("SELECT status FROM books")["status"] == "draft"  # one chapter still missing
    assert len(deps.backup.sent) == 4
    assert run(deps, voiced, private_to="cap@test.invalid")
    assert len(deps.backup.sent) == 6  # only the third chapter was sent
    assert deps.db.one("SELECT status FROM books")["status"] == "published"
    assert run(deps, voiced, private_to="cap@test.invalid")
    assert len(deps.backup.sent) == 6


def test_a_failing_chapter_is_reported_and_the_rest_still_go_in(deps, voiced, captain):
    (voiced / "chapter_02_timing.json").write_text("not json")
    assert run(deps, voiced, private_to="cap@test.invalid") is False
    ready = deps.db.q("SELECT n FROM chapters WHERE status = 'ready' ORDER BY n")
    assert [r["n"] for r in ready] == [1, 3]
    assert deps.db.one("SELECT status FROM books")["status"] == "draft"  # never half-published


def test_telegram_refusal_leaves_the_chapter_unlisted(deps, voiced, captain):
    deps.backup = FakeBackup(fail_times=999, permanent=True)
    assert run(deps, voiced, private_to="cap@test.invalid") is False
    assert deps.db.q("SELECT 1 FROM chapters WHERE status = 'ready'") == []


def test_private_to_accepts_a_username_too(deps, voiced, captain):
    assert run(deps, voiced, private_to="Capn")
    assert str(deps.db.one("SELECT private_to FROM books")["private_to"]) == captain


def test_unknown_owner_or_empty_folder_is_a_clear_refusal(deps, voiced, tmp_path):
    with pytest.raises(CommandError, match="not a member"):
        run(deps, voiced, private_to="nobody@test.invalid")
    assert deps.db.q("SELECT 1 FROM books") == []
    (tmp_path / "empty").mkdir()
    with pytest.raises(CommandError, match="no chapter_NN"):
        run(deps, tmp_path / "empty")
