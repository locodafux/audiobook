"""Invites through a fake Supabase admin API plus the real members table (local database)."""

from __future__ import annotations

import json
import uuid

import httpx
import pytest

from hearthread import invites


@pytest.fixture
def admin(db):
    calls: list[tuple[str, str, dict]] = []

    def handler(req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content or b"{}")
        calls.append((req.method, req.url.path, body))
        if req.method == "POST":  # like GoTrue: creates the account, sends no mail
            uid = str(uuid.uuid4())
            db.x("INSERT INTO auth.users (id, email) VALUES (%s, %s)", (uid, body["email"]))
            return httpx.Response(200, json={"id": uid})
        return httpx.Response(200, json={})

    a = invites.Admin("http://x", "svc", transport=httpx.MockTransport(handler))
    a.calls = calls
    return a


def test_add_creates_account_without_mail_and_member_row(db, admin):
    assert invites.add(db, admin, " Ana@Test.invalid ", "Ana", "Leo") == "invited ana@test.invalid"
    m = db.one("SELECT * FROM members")
    assert (m["email"], m["display_name"], m["invited_by"], m["status"]) == (
        "ana@test.invalid",
        "Ana",
        "Leo",
        "active",
    )
    method, path, body = admin.calls[0]
    assert (method, path) == ("POST", "/auth/v1/admin/users")
    assert body == {"email": "ana@test.invalid", "email_confirm": True}


def test_add_twice_is_harmless(db, admin):
    invites.add(db, admin, "a@test.invalid", None, None)
    assert "already invited" in invites.add(db, admin, "a@test.invalid", None, None)
    assert len(admin.calls) == 1 and db.one("SELECT count(*) AS n FROM members")["n"] == 1


def test_add_reuses_existing_auth_account(db, admin):
    db.x("INSERT INTO auth.users (id, email) VALUES (%s, 'b@test.invalid')", (str(uuid.uuid4()),))
    invites.add(db, admin, "b@test.invalid", "B", None)
    assert admin.calls == []  # no second account
    assert db.one("SELECT count(*) AS n FROM members")["n"] == 1


def test_revoke_marks_revoked_and_bans_then_reinvite_unbans(db, admin):
    invites.add(db, admin, "a@test.invalid", None, None)
    uid = str(db.one("SELECT user_id FROM members")["user_id"])
    assert invites.revoke(db, admin, "a@test.invalid") == "revoked a@test.invalid"
    m = db.one("SELECT status, revoked_at FROM members")
    assert m["status"] == "revoked" and m["revoked_at"]
    assert admin.calls[-1] == (
        "PUT",
        f"/auth/v1/admin/users/{uid}",
        {"ban_duration": invites.BAN_FOREVER},
    )

    assert invites.add(db, admin, "a@test.invalid", None, None) == "re-invited a@test.invalid"
    assert admin.calls[-1][2] == {"ban_duration": "none"}
    assert db.one("SELECT status, revoked_at FROM members") == {
        "status": "active",
        "revoked_at": None,
    }


def test_revoke_unknown_and_bad_email(db, admin):
    with pytest.raises(invites.InviteError, match="not on the invite list"):
        invites.revoke(db, admin, "nobody@test.invalid")
    with pytest.raises(invites.InviteError, match="not an email"):
        invites.add(db, admin, "nope", None, None)


def test_admin_errors_are_reported(db):
    bad = invites.Admin(
        "http://x",
        "k",
        transport=httpx.MockTransport(lambda r: httpx.Response(422, text="email_exists")),
    )
    with pytest.raises(invites.InviteError, match="422"):
        invites.add(db, bad, "z@test.invalid", None, None)
    assert db.one("SELECT count(*) AS n FROM members")["n"] == 0  # nothing half-created


def test_list_shows_not_yet_signed_in(db, admin):
    invites.add(db, admin, "a@test.invalid", "Ana", None)
    rows = invites.list_members(db)
    assert rows[0]["email"] == "a@test.invalid" and rows[0]["last_sign_in_at"] is None
