"""Invite-only sign-in: the Supabase admin API creates/bans accounts, `members` says who may in."""

from __future__ import annotations

import getpass
from typing import Any

import httpx

from .db import Db

BAN_FOREVER = "876000h"  # ~100 years; Supabase has no "permanent" value


class InviteError(Exception):
    pass


class Admin:
    """Auth admin API with the service key. Never sends an email (invite = silent account)."""

    def __init__(self, url: str, service_key: str, transport: httpx.BaseTransport | None = None):
        self._http = httpx.Client(
            base_url=f"{url.rstrip('/')}/auth/v1/admin",
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            timeout=30,
            transport=transport,
        )

    def _check(self, resp: httpx.Response) -> dict[str, Any]:
        if resp.status_code >= 400:
            raise InviteError(f"Supabase admin API {resp.status_code}: {resp.text[:300]}")
        return resp.json()

    def create_user(self, email: str) -> str:
        """Account without sending mail; email_confirm so the first code login works at once."""
        body = self._check(self._http.post("/users", json={"email": email, "email_confirm": True}))
        return body["id"]

    def set_ban(self, user_id: str, ban_duration: str) -> None:
        self._check(self._http.put(f"/users/{user_id}", json={"ban_duration": ban_duration}))

    def check(self) -> None:
        self._check(self._http.get("/users", params={"per_page": 1}))


def _norm(email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or email.startswith("@") or email.endswith("@"):
        raise InviteError(f"{email!r} is not an email address")
    return email


def _auth_user_id(db: Db, email: str) -> str | None:
    row = db.one("SELECT id FROM auth.users WHERE lower(email) = %s", (email,))
    return str(row["id"]) if row else None


def add(db: Db, admin: Admin, email: str, name: str | None, invited_by: str | None) -> str:
    """Create the sign-in account (if needed) and the members row. Safe to run twice."""
    email = _norm(email)
    member = db.one("SELECT user_id, status FROM members WHERE email = %s", (email,))
    if member and member["status"] == "active":
        return f"{email} is already invited"
    user_id = str(member["user_id"]) if member else _auth_user_id(db, email)
    if user_id is None:
        user_id = admin.create_user(email)
    if member:  # revoked before: let them back in
        admin.set_ban(user_id, "none")
        db.x(
            "UPDATE members SET status = 'active', revoked_at = NULL,"
            " display_name = coalesce(%s, display_name) WHERE user_id = %s",
            (name, user_id),
        )
        return f"re-invited {email}"
    db.x(
        "INSERT INTO members (user_id, email, display_name, invited_by, status)"
        " VALUES (%s, %s, %s, %s, 'active')",
        (user_id, email, name or email.split("@")[0], invited_by or getpass.getuser()),
    )
    return f"invited {email}"


def revoke(db: Db, admin: Admin, email: str) -> str:
    """Revoked in the database first (data access ends at once), then banned (tokens stop)."""
    email = _norm(email)
    member = db.one("SELECT user_id FROM members WHERE email = %s", (email,))
    if not member:
        raise InviteError(f"{email} is not on the invite list")
    db.x(
        "UPDATE members SET status = 'revoked', revoked_at = now() WHERE user_id = %s",
        (member["user_id"],),
    )
    admin.set_ban(str(member["user_id"]), BAN_FOREVER)
    return f"revoked {email}"


def list_members(db: Db) -> list[dict[str, Any]]:
    return db.q(
        """SELECT m.email, m.display_name, m.invited_by, m.status, m.created_at,
                  u.last_sign_in_at
           FROM members m LEFT JOIN auth.users u ON u.id = m.user_id
           ORDER BY m.created_at"""
    )
