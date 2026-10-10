"""hearthread command line. Everything defaults to dev; real data needs --prod."""

from __future__ import annotations

import argparse
import asyncio
import logging
import shutil
import sys
from collections.abc import Callable
from pathlib import Path

from . import importer, invites, library
from .deps import Deps, build
from .library import CommandError
from .settings import REQUIRED, ConfigError, Settings, load_env
from .worker import WorkerBusy, run_worker, wipe_tmp, worker_lock


def _ask(prompt: str) -> bool:
    return input(f"{prompt} [y/N] ").strip().lower() in ("y", "yes")


def banner(prod: bool) -> None:
    text = (
        "PROD: real database, library folder and Telegram chat"
        if prod
        else "DEV: dev database, library folder and chat"
    )
    if sys.stderr.isatty():
        text = f"\033[1;{'41' if prod else '42'}m {text} \033[0m"
    print(f"=== {text} ===", file=sys.stderr)


def doctor(prod: bool) -> int:
    env = load_env(prod)
    ok_all = True

    def row(name: str, ok: bool, detail: str = "") -> None:
        nonlocal ok_all
        ok_all &= ok
        print(f"  [{'ok' if ok else 'FAIL'}] {name}{': ' + detail if detail else ''}")

    missing = [n for n in REQUIRED if n not in env]
    row(
        "settings",
        not missing,
        f"missing {', '.join(missing)}" if missing else "all required names set",
    )
    for tool in ("ffmpeg", "ffprobe"):
        row(tool, shutil.which(tool) is not None)
    from .deps import state_dir

    row(
        "free disk",
        library.free_disk_gb(state_dir()) > 2,
        f"{library.free_disk_gb(state_dir()):.0f} GB",
    )
    if missing:
        return 1
    deps = build(Settings.from_env(env, prod))
    try:
        for name, probe in (
            ("database", lambda: deps.db.one("SELECT 1 AS ok")),
            ("library folder", deps.store.check),
            (
                "Supabase admin API",
                invites.Admin(deps.settings.supabase_url, deps.settings.service_key).check,
            ),
            ("Telegram", lambda: asyncio.run(deps.backup.check())),
        ):
            try:
                result = probe()
                row(name, True, result if isinstance(result, str) else "")
            except Exception as exc:  # noqa: BLE001 - report every failure, keep checking
                row(name, False, f"{type(exc).__name__}: {str(exc)[:150]}")
    finally:
        deps.db.close()
    print("all good" if ok_all else "some checks failed")
    return 0 if ok_all else 1


def _common() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("--prod", action="store_true", default=argparse.SUPPRESS, help="use .env.prod")
    return p


def make_parser() -> argparse.ArgumentParser:
    common = _common()
    ap = argparse.ArgumentParser(prog="hearthread", description=__doc__)
    ap.add_argument("--prod", action="store_true", help="use .env.prod (default is .env.dev)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def cmd(name: str, help: str, *args: tuple) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help, parents=[common])
        for flags, kw in args:
            p.add_argument(*flags, **kw)
        return p

    book = (("book",), {})
    yes = (("--yes", "-y"), {"action": "store_true", "help": "skip confirmation prompts"})
    cmd("doctor", "check settings, database, library folder, Telegram, ffmpeg and disk")
    cmd(
        "add",
        "read an EPUB and queue its chapters",
        (("epub",), {"type": Path}),
        (("--id",), {"help": "short book id / library folder (default: from the title)"}),
        yes,
    )
    cmd(
        "cover",
        "set a book's cover picture (default: the one from its EPUB, kept in the library folder)",
        book,
        (("image",), {"type": Path, "nargs": "?", "help": "a picture file (any size, shrunk)"}),
    )
    cmd(
        "run",
        "the worker (one per Mac)",
        (("--once",), {"action": "store_true", "help": "exit when the list is empty"}),
    )
    cmd("status", "counts, failure reasons, backup state", (("book",), {"nargs": "?"}))
    cmd("retry", "put failed chapters back on the list", book, (("--chapter",), {"type": int}))
    cmd("cancel", "remove waiting chapters", book)
    cmd(
        "publish",
        "show a book in the app",
        book,
        (("--force",), {"action": "store_true", "help": "even if some chapters are not ready"}),
    )
    cmd("unpublish", "hide a book from the app", book)
    cmd(
        "regen",
        "re-make chapters (numbering guard)",
        book,
        (("--chapters",), {"help": "e.g. 3-5 or 2,7-9 (default all)"}),
        (("--accept-renumber",), {"action": "store_true"}),
    )
    cmd(
        "backup-retry",
        "re-upload chapters to Telegram from the library folder",
        (("--all",), {"action": "store_true", "help": "every ready chapter (Telegram lost files)"}),
    )
    cmd(
        "import-voiced",
        "bring chapters voiced by the previous app into Telegram and the list",
        (("folder",), {"type": Path}),
        (("--id",), {"required": True, "help": "short book id / library folder"}),
        (("--title",), {"required": True}),
        (("--author",), {}),
        (("--series",), {"help": "series title"}),
        (("--volume",), {"type": int}),
        (("--first-chapter",), {"type": int, "default": 1, "help": "number shown for file 1"}),
        (
            ("--private-to",),
            {"metavar": "USERNAME", "help": "only this member (username or email) sees the book"},
        ),
        (("--limit",), {"type": int, "help": "upload at most this many chapters, then stop"}),
    )
    cmd("remove", "delete a book from the list and the library folder", book, yes)
    inv = cmd("invite", "manage who may sign in").add_subparsers(dest="invite_cmd", required=True)
    a = inv.add_parser("add", parents=[common], help="invite an email address")
    a.add_argument("email")
    a.add_argument("--name")
    r = inv.add_parser("revoke", parents=[common], help="end someone's access")
    r.add_argument("email")
    inv.add_parser("list", parents=[common], help="who is invited")
    cmd("clean", "delete leftover temp folders")
    return ap


def _members_table(rows: list[dict]) -> str:
    if not rows:
        return "nobody is invited yet"
    lines = [f"{'email':32} {'name':16} {'status':8} signed in"]
    for m in rows:
        seen = m["last_sign_in_at"].strftime("%Y-%m-%d") if m["last_sign_in_at"] else "not yet"
        lines.append(f"{m['email']:32} {(m['display_name'] or ''):16} {m['status']:8} {seen}")
    return "\n".join(lines)


def dispatch(args: argparse.Namespace, deps: Deps, confirm: Callable[[str], bool]) -> int:
    ask = (lambda _m: True) if getattr(args, "yes", False) else confirm
    c = args.cmd
    if c == "add":
        library.add(deps, args.epub, args.id, ask)
    elif c == "cover":
        library.set_cover(deps, args.book, args.image)
    elif c == "run":
        try:
            with worker_lock(deps.state_dir):
                asyncio.run(run_worker(deps, once=args.once))
        except WorkerBusy as exc:
            raise CommandError(str(exc)) from exc
    elif c == "status":
        print(library.status(deps, args.book))
    elif c == "retry":
        print(f"queued {library.retry(deps, args.book, args.chapter)} chapters")
    elif c == "cancel":
        print(library.cancel(deps, args.book))
    elif c == "publish":
        print(library.publish(deps, args.book, args.force))
    elif c == "unpublish":
        print(library.unpublish(deps, args.book))
    elif c == "regen":
        library.regen(deps, args.book, args.chapters, args.accept_renumber)
    elif c == "backup-retry":
        print(f"queued {library.backup_retry(deps, args.all)} uploads")
    elif c == "import-voiced":
        ok = importer.import_voiced(
            deps,
            args.folder,
            args.id,
            args.title,
            args.author,
            args.series,
            args.volume,
            args.first_chapter,
            args.private_to,
            args.limit,
        )
        return 0 if ok else 1
    elif c == "remove":
        library.remove(deps, args.book, ask)
    elif c == "clean":
        try:
            with worker_lock(deps.state_dir):
                print(f"removed {wipe_tmp(deps.tmp_base)} leftover folders")
        except WorkerBusy as exc:
            raise CommandError(f"{exc}; stop it first") from exc
    elif c == "invite":
        s = deps.settings
        if args.invite_cmd == "list":
            print(_members_table(invites.list_members(deps.db)))
        else:
            admin = invites.Admin(s.supabase_url, s.service_key)
            if args.invite_cmd == "add":
                print(invites.add(deps.db, admin, args.email, args.name, s.inviter))
            else:
                print(invites.revoke(deps.db, admin, args.email))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = make_parser().parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
    banner(args.prod)
    if args.cmd == "doctor":
        return doctor(args.prod)
    try:
        deps = build(Settings.from_env(load_env(args.prod), args.prod))
    except ConfigError as exc:
        print(f"error: {exc} (see generator/.env.example)", file=sys.stderr)
        return 2
    try:
        return dispatch(args, deps, _ask)
    except invites.InviteError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except library.RenumberRefused as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 3
    except CommandError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130
    finally:
        deps.db.close()


if __name__ == "__main__":
    sys.exit(main())
