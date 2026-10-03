"""Cloudflare R2 through its S3 API. Deterministic keys make retried uploads overwrite safely."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Protocol

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


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


class R2:
    def __init__(self, account_id: str, bucket: str, key_id: str, secret: str) -> None:
        self.bucket = bucket
        self._s3 = boto3.client(
            "s3",
            endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=key_id,
            aws_secret_access_key=secret,
            region_name="auto",
            config=Config(
                retries={"max_attempts": 5, "mode": "standard"},
                # R2 rejects the SDK's newer default trailing checksums
                request_checksum_calculation="when_required",
                response_checksum_validation="when_required",
            ),
        )

    def check(self) -> None:
        self._s3.head_bucket(Bucket=self.bucket)

    def head(self, key: str) -> dict | None:
        """{'size': int, 'sha256': str|None} or None when the object does not exist."""
        try:
            h = self._s3.head_object(Bucket=self.bucket, Key=key)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in ("404", "NoSuchKey", "NotFound"):
                return None
            raise
        return {"size": h["ContentLength"], "sha256": h.get("Metadata", {}).get("sha256")}

    def put_file(self, key: str, path: Path, content_type: str) -> str:
        """Upload then verify (HEAD: size and sha256). Returns the sha256."""
        sha = sha256_file(path)
        self._s3.upload_file(
            str(path),
            self.bucket,
            key,
            ExtraArgs={"ContentType": content_type, "Metadata": {"sha256": sha}},
        )
        got = self.head(key)
        if not got or got["size"] != path.stat().st_size or got["sha256"] != sha:
            raise RuntimeError(f"upload of {key} did not verify (got {got})")
        return sha

    def put_bytes(self, key: str, data: bytes, content_type: str) -> str:
        sha = hashlib.sha256(data).hexdigest()
        self._s3.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            Metadata={"sha256": sha},
        )
        got = self.head(key)
        if not got or got["size"] != len(data) or got["sha256"] != sha:
            raise RuntimeError(f"upload of {key} did not verify (got {got})")
        return sha

    def get_file(self, key: str, dest: Path) -> None:
        self._s3.download_file(self.bucket, key, str(dest))

    def delete_prefix(self, prefix: str) -> int:
        n = 0
        for page in self._s3.get_paginator("list_objects_v2").paginate(
            Bucket=self.bucket, Prefix=prefix
        ):
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            if keys:
                self._s3.delete_objects(Bucket=self.bucket, Delete={"Objects": keys})
                n += len(keys)
        return n
