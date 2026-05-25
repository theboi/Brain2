"""Blob handling: SSRF guard, size limits, AV scan stub, in-memory object store."""
from __future__ import annotations

import ipaddress
import socket
import uuid
from urllib.parse import urlparse

from brain2.errors import SSRFBlocked

_MAX_BLOB_BYTES = 50 * 1024 * 1024   # 50 MiB

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


class BlobTooLarge(Exception):
    """Uploaded blob exceeds the size limit."""


class AVScanFailed(Exception):
    """AV scan detected a threat in the uploaded blob."""


def _check_ip(ip, url: str) -> None:
    for network in _PRIVATE_NETWORKS:
        if ip in network:
            raise SSRFBlocked(f"URL {url!r} resolves to private/loopback address {ip}")


def ssrf_check_url(url: str) -> None:
    """Raise SSRFBlocked if the URL resolves to a private/loopback address."""
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        raise SSRFBlocked(f"cannot parse host from URL: {url!r}")
    # Try numeric IP first (no DNS needed)
    try:
        ip = ipaddress.ip_address(host)
        _check_ip(ip, url)
        return
    except ValueError:
        pass
    # DNS resolution
    try:
        infos = socket.getaddrinfo(host, None)
        for *_, sockaddr in infos:
            ip = ipaddress.ip_address(sockaddr[0])
            _check_ip(ip, url)
    except SSRFBlocked:
        raise
    except OSError:
        raise SSRFBlocked(f"cannot resolve host {host!r}")


def av_scan(data: bytes) -> None:
    """AV scan stub — raises AVScanFailed if EICAR test string is present."""
    eicar = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    if eicar in data:
        raise AVScanFailed("EICAR test string detected")


class BlobStore:
    """In-memory blob store (LocalStore seam)."""

    def __init__(self, max_bytes: int = _MAX_BLOB_BYTES) -> None:
        self._max_bytes = max_bytes
        self._blobs: dict[str, bytes] = {}

    def upload(self, data: bytes, filename: str = "") -> str:
        if len(data) > self._max_bytes:
            raise BlobTooLarge(
                f"blob {filename!r} is {len(data)} bytes; max is {self._max_bytes}")
        av_scan(data)
        blob_id = str(uuid.uuid4())
        self._blobs[blob_id] = data
        return blob_id

    def retrieve(self, blob_id: str) -> bytes:
        if blob_id not in self._blobs:
            raise KeyError(f"blob {blob_id!r} not found")
        return self._blobs[blob_id]

    def delete(self, blob_id: str) -> None:
        self._blobs.pop(blob_id, None)
