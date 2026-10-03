"""CLI wiring: dispatch with fakes, and the dev/prod banner."""

from __future__ import annotations

import pytest

from fakes import needs_ffmpeg
from hearthread import cli
from hearthread.library import CommandError


def test_banner_says_loudly_which_environment(capsys):
    cli.banner(False)
    cli.banner(True)
    err = capsys.readouterr().err
    assert "DEV" in err and "PROD" in err


def test_missing_settings_exit_code_2_and_names_only(monkeypatch, capsys):
    monkeypatch.setattr("hearthread.cli.load_env", lambda prod: {"R2_BUCKET": "secret-value"})
    assert cli.main(["status"]) == 2
    err = capsys.readouterr().err
    assert "SUPABASE_URL" in err and "secret-value" not in err


@needs_ffmpeg
def test_dispatch_add_run_status(deps, epub, capsys):
    p = cli.make_parser()
    assert cli.dispatch(p.parse_args(["add", str(epub), "--yes"]), deps, lambda m: False) == 0
    assert cli.dispatch(p.parse_args(["run", "--once"]), deps, lambda m: False) == 0
    cli.dispatch(p.parse_args(["status"]), deps, lambda m: False)
    assert "3/3 ready" in capsys.readouterr().out
    cli.dispatch(p.parse_args(["clean"]), deps, lambda m: False)
    with pytest.raises(CommandError):
        cli.dispatch(p.parse_args(["publish", "nope"]), deps, lambda m: False)
