"""Logic that needs no database: settings, helpers, timing/join, voice retries, Telegram."""

from __future__ import annotations

import asyncio
import hashlib
import json

import httpx
import pytest

from fakes import FakeVoice, needs_ffmpeg
from hearthread import audio
from hearthread.book import chapter_keys, input_hash, parse_range, slugify, text_sha256
from hearthread.cli import make_parser
from hearthread.library import _renumber_changes
from hearthread.settings import ConfigError, Settings, load_env, parse_env_file
from hearthread.telegram import Sent, Telegram, TelegramError
from hearthread.voice import EdgeVoice

ENV = {
    "SUPABASE_URL": "http://x/",
    "SUPABASE_DB_URL": "postgresql://x",
    "SUPABASE_SERVICE_KEY": "k",
    "TELEGRAM_BOT_TOKEN": "t",
    "TELEGRAM_BACKUP_CHAT_ID": "c",
}


def test_default_narration_is_normal_speed():
    s = Settings.from_env(ENV)
    assert (s.voice, s.rate, s.volume) == ("en-US-BrianNeural", "+0%", "+0%")
    assert not s.prod and s.label == "DEV"


def test_missing_settings_are_named_without_values():
    with pytest.raises(ConfigError) as e:
        Settings.from_env({"TELEGRAM_BOT_TOKEN": "secret-value"})
    assert "SUPABASE_DB_URL" in str(e.value) and "secret-value" not in str(e.value)


def test_env_file_dev_prod_and_environment_override(tmp_path, monkeypatch):
    (tmp_path / ".env.dev").write_text('# c\nSUPABASE_URL="dev-url"\nexport TTS_RATE=+10%\n')
    (tmp_path / ".env.prod").write_text("SUPABASE_URL=prod-url\n")
    assert load_env(False, tmp_path)["SUPABASE_URL"] == "dev-url"
    assert load_env(True, tmp_path)["SUPABASE_URL"] == "prod-url"
    monkeypatch.setenv("SUPABASE_URL", "from-env")
    assert load_env(False, tmp_path)["SUPABASE_URL"] == "from-env"
    assert parse_env_file(tmp_path / ".env.dev")["TTS_RATE"] == "+10%"


def test_prod_flag_anywhere_dev_by_default():
    p = make_parser()
    assert p.parse_args(["status"]).prod is False
    assert p.parse_args(["--prod", "status"]).prod is True
    assert p.parse_args(["run", "--once", "--prod"]).prod is True
    assert p.parse_args(["invite", "add", "a@b.c", "--prod"]).prod is True


def test_helpers():
    assert slugify("The Art of  Seduction!") == "the-art-of-seduction"
    assert slugify("???") == "book"
    assert parse_range("3-5,9", 10) == [3, 4, 5, 9]
    assert parse_range(None, 3) == [1, 2, 3]
    with pytest.raises(ValueError):
        parse_range("2-11", 10)
    assert chapter_keys("b", 7) == ("books/b/ch-0007.mp3", "books/b/ch-0007.timing.json")
    base = input_hash("p1", ["a"], "v", "+0%")
    assert base != input_hash("p2", ["a"], "v", "+0%")
    assert base != input_hash("p1", ["a"], "v", "-5%")
    assert base != input_hash("p1", ["b"], "v", "+0%")
    assert text_sha256(["a"]) != text_sha256(["a", "b"])


def test_numbering_guard_detects_changes():
    old = [{"n": 1, "title": "One", "source_ref": "a"}, {"n": 2, "title": "Two", "source_ref": "b"}]
    assert _renumber_changes(old, [("One", "a"), ("Two", "b")]) == []
    assert _renumber_changes(old, [("One", "a")])  # count changed
    assert _renumber_changes(old, [("X", "z"), ("Two", "b")])  # chapter 1 moved
    # no fingerprints: fall back to titles
    t = [{"n": 1, "title": "One", "source_ref": ""}]
    assert _renumber_changes(t, [("One", "")]) == []
    assert _renumber_changes(t, [("Uno", "")])


def test_timing_file_shape():
    t = audio.build_timing(["a", "b"], [1.5, 2.0])
    assert t == {
        "v": 1,
        "sentences": [
            {"i": 0, "t": "a", "s": 0.0, "e": 1.5},
            {"i": 1, "t": "b", "s": 1.5, "e": 3.5},
        ],
    }
    assert json.loads(audio.timing_bytes(t)) == t


@needs_ffmpeg
def test_join_matches_and_mismatch_fails(clip, tmp_path):
    clips = [tmp_path / f"{i}.mp3" for i in range(5)]
    for c in clips:
        c.write_bytes(clip.read_bytes())
    lengths = [audio.mp3_length(c) for c in clips]
    out = tmp_path / "all.mp3"
    audio.concat_mp3(clips, out)
    assert audio.check_join(out, lengths) == pytest.approx(sum(lengths), abs=0.3)
    with pytest.raises(RuntimeError, match="add up"):
        audio.check_join(out, [x + 5 for x in lengths])


def test_voice_retries_then_succeeds(tmp_path, monkeypatch):
    tries = {"n": 0}
    slept: list[float] = []

    async def fake_sleep(s):
        slept.append(s)

    v = EdgeVoice("en-US-BrianNeural", max_retries=3, sleep=fake_sleep)

    async def once(text, dest):
        tries["n"] += 1
        if tries["n"] < 3:
            raise RuntimeError("No audio was received")

    monkeypatch.setattr(v, "_once", once)
    asyncio.run(v.synth("hi", tmp_path / "x.mp3"))
    assert tries["n"] == 3 and slept == [0.5, 1.0]

    tries["n"] = -10
    with pytest.raises(RuntimeError, match="after 3 tries"):
        asyncio.run(v.synth("hi", tmp_path / "x.mp3"))


def test_fake_voice_fails_twice_then_works(clip, tmp_path):
    v = FakeVoice(clip, fail={"x": 2})
    for expect in (False, False, True):
        try:
            asyncio.run(v.synth("x", tmp_path / "o.mp3"))
            assert expect
        except RuntimeError:
            assert not expect


def _tg(handler, sleeps, clock=None, **kw):
    now = [0.0]
    return Telegram(
        "tok",
        "chat",
        transport=httpx.MockTransport(handler),
        sleep=lambda s: _record(sleeps, now, s),
        clock=clock or (lambda: now[0]),
        **kw,
    )


async def _record(sleeps, now, s):
    sleeps.append(s)
    now[0] += s


def test_telegram_honours_retry_after_and_rate_limit(tmp_path):
    f = tmp_path / "a.mp3"
    f.write_bytes(b"x")
    calls = []

    def handler(req):
        calls.append(req)
        if len(calls) == 1:
            return httpx.Response(
                429,
                json={
                    "ok": False,
                    "description": "Too Many Requests",
                    "parameters": {"retry_after": 7},
                },
            )
        doc = {"file_id": "FID", "file_unique_id": "UID"}
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 42, "document": doc}})

    sleeps: list[float] = []
    tg = _tg(handler, sleeps)
    assert asyncio.run(tg.send_document(f, "c")) == Sent(42, "FID", "UID")
    assert 7 in sleeps  # waited exactly what Telegram asked
    assert len(calls) == 2

    # two sends back to back are spaced by the min interval
    sleeps.clear()
    calls.clear()
    calls.append(None)  # skip the 429 branch
    asyncio.run(tg.send_document(f, "c"))
    assert any(s > 0 for s in sleeps)


def test_telegram_permanent_error_does_not_retry(tmp_path):
    f = tmp_path / "a.mp3"
    f.write_bytes(b"x")
    n = []

    def handler(req):
        n.append(1)
        return httpx.Response(401, json={"ok": False, "description": "Unauthorized"})

    with pytest.raises(TelegramError) as e:
        asyncio.run(_tg(handler, []).send_document(f, "c"))
    assert e.value.permanent and len(n) == 1


def test_telegram_gives_up_after_retries(tmp_path):
    f = tmp_path / "a.mp3"
    f.write_bytes(b"x")
    n = []

    def handler(req):
        n.append(1)
        raise httpx.ConnectError("down")

    with pytest.raises(TelegramError, match="after 3 tries"):
        asyncio.run(_tg(handler, [], max_retries=3).send_document(f, "c"))
    assert len(n) == 3


def test_telegram_refuses_what_a_bot_could_not_download_again(tmp_path, monkeypatch):
    f = tmp_path / "big.mp3"
    f.write_bytes(b"x")
    monkeypatch.setattr("hearthread.telegram.BOT_FILE_LIMIT", 0)
    with pytest.raises(TelegramError) as e:
        asyncio.run(_tg(lambda r: httpx.Response(200), []).send_document(f, "c"))
    assert e.value.permanent


def test_default_parser_adapts_the_real_epub_reader(monkeypatch, tmp_path):
    from hearthread import epub
    from hearthread.book import default_parser

    real = epub.Book(
        title="T", author=None, description=None, language="en", series="S", volume=2,
        cover=b"jpg",
        chapters=(
            epub.Chapter(1, "One", ("a.", "b."), "x.xhtml#c1", "h1"),
            epub.Chapter(2, "Two", (), "x.xhtml#c2", "h2", error="boom"),
        ),
    )  # fmt: skip
    monkeypatch.setattr(epub, "parse", lambda path: real)
    b = default_parser(tmp_path / "x.epub")
    assert (b.title, b.author, b.series_title, b.volume, b.parser_version) == (
        "T",
        "",
        "S",
        2,
        epub.PARSER_VERSION,
    )
    assert b.chapters[0].sentences == ["a.", "b."] and b.chapters[0].source_ref == "x.xhtml#c1"
    assert b.chapters[1].error == "boom"


def test_library_folder_stores_verifies_and_stays_inside_itself(tmp_path):
    from hearthread.store import LocalStore

    root = tmp_path / "lib"
    st = LocalStore(root)
    st.check()
    src = tmp_path / "a.bin"
    src.write_bytes(b"abc")
    sha = st.put_file("books/b/ch-0001.mp3", src, "audio/mpeg")
    assert sha == hashlib.sha256(b"abc").hexdigest()
    assert st.head("books/b/ch-0001.mp3") == {"size": 3, "sha256": None}
    assert st.head("books/b/nope") is None
    st.put_bytes("books/b/cover.jpg", b"jpg", "image/jpeg")
    out = tmp_path / "out"
    st.get_file("books/b/ch-0001.mp3", out)
    assert out.read_bytes() == b"abc"
    assert not list(root.rglob("*.part"))  # copies are atomic
    assert st.delete_prefix("books/b/ch-0001.") == 1  # one chapter's files, not its neighbours
    assert st.head("books/b/cover.jpg")
    assert st.delete_prefix("books/b/") == 1 and st.head("books/b/cover.jpg") is None
    with pytest.raises(ValueError):
        st.put_bytes("../escape", b"x", "x")


# --- cover command (a stub database, so no Supabase needed) ------------------------------------


class _OneBookDb:
    def __init__(self) -> None:
        self.cover_file_id: str | None = None

    def one(self, sql, params=None):
        return {"id": params[0], "title": "Made Up Tale"} if params[0] == "tale" else None

    def x(self, sql, params=None):
        assert "UPDATE books SET cover_file_id" in sql
        self.cover_file_id = params[0]
        return 1


def _cover_deps(tmp_path):
    from fakes import FakeBackup, FakeStore, mk_settings
    from hearthread.deps import Deps

    return Deps(
        settings=mk_settings(), db=_OneBookDb(), store=FakeStore(), backup=FakeBackup(),
        voice=None, tmp_base=tmp_path / "tmp", state_dir=tmp_path,
    )  # fmt: skip


def _png(path, size=(1200, 1800)):
    from PIL import Image

    Image.new("RGB", size, "teal").save(path)
    return path


def test_cover_command_shrinks_stores_uploads_and_records_the_file_id(tmp_path):
    import io

    from PIL import Image

    from hearthread import library

    deps = _cover_deps(tmp_path)
    msgs: list[str] = []
    library.set_cover(deps, "tale", _png(tmp_path / "c.png"), msgs.append)
    stored, kind = deps.store.objects["books/tale/cover.jpg"]
    assert kind == "image/jpeg" and Image.open(io.BytesIO(stored)).size == (400, 600)
    assert deps.backup.sent == [("tale-cover.jpg", "tale cover")]
    assert deps.db.cover_file_id == "file-id-1" and "cover set" in msgs[0]


def test_cover_command_without_an_image_reuses_the_library_folder_copy(tmp_path):
    from hearthread import library

    deps = _cover_deps(tmp_path)
    with pytest.raises(library.CommandError, match="pass an image"):
        library.set_cover(deps, "tale", None, lambda m: None)
    big = _png(tmp_path / "c.png")
    deps.store.put_bytes("books/tale/cover.jpg", big.read_bytes(), "image/jpeg")
    library.set_cover(deps, "tale", None, lambda m: None)
    assert deps.db.cover_file_id == "file-id-1"


def test_cover_command_refuses_unknown_books_bad_images_and_a_telegram_failure(tmp_path):
    from fakes import FakeBackup
    from hearthread import library

    deps = _cover_deps(tmp_path)
    with pytest.raises(library.CommandError, match="no book"):
        library.set_cover(deps, "nope", _png(tmp_path / "c.png"), lambda m: None)
    junk = tmp_path / "junk.png"
    junk.write_bytes(b"not an image")
    with pytest.raises(library.CommandError, match="not an image"):
        library.set_cover(deps, "tale", junk, lambda m: None)
    with pytest.raises(library.CommandError, match="is not a file"):
        library.set_cover(deps, "tale", tmp_path / "missing.png", lambda m: None)
    deps.backup = FakeBackup(fail_times=1, permanent=True)
    with pytest.raises(library.CommandError, match="Telegram refused"):
        library.set_cover(deps, "tale", _png(tmp_path / "c.png"), lambda m: None)
    assert deps.db.cover_file_id is None


def test_cover_is_a_command():
    args = make_parser().parse_args(["cover", "tale", "pic.png"])
    assert (args.cmd, args.book, str(args.image)) == ("cover", "tale", "pic.png")
    assert make_parser().parse_args(["cover", "tale"]).image is None
