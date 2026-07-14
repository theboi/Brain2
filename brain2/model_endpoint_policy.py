"""Validation for admin-configured Ollama endpoints.

This is target hardening for saved model configuration, not a complete SSRF
defence. Callers must apply it both when persisting and when using an endpoint
so legacy rows and environment allowlist changes fail closed.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlparse

from brain2.errors import Conflict


_METADATA_HOSTS = {
    "instance-data",
    "instance-data.ec2.internal",
    "metadata.aws.internal",
    "metadata.azure.internal",
    "metadata.google.internal",
    "metadata.goog",
}
_METADATA_IPS = {
    ipaddress.ip_address("100.100.100.200"),
    ipaddress.ip_address("fd00:ec2::254"),
}
_DEFAULT_OLLAMA_HOSTS = {"localhost", "localhost.localdomain"}


def normalize_ollama_base_url(value) -> str:
    """Return a normalized endpoint or raise a secret-safe ``Conflict``."""
    endpoint = str(value or "").strip().rstrip("/")
    if not endpoint:
        raise Conflict("ollama_base_url is required for ollama")
    if not endpoint.startswith(("http://", "https://")) or "\\" in endpoint:
        raise Conflict(
            "ollama_base_url must be a valid http or https URL"
        )
    parsed = urlparse(endpoint)
    try:
        parsed.port
    except ValueError as exc:
        raise Conflict(
            "ollama_base_url must be a valid http or https URL"
        ) from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or "?" in endpoint
        or "#" in endpoint
    ):
        raise Conflict("ollama_base_url must be a valid http or https URL")
    host = parsed.hostname.lower().rstrip(".")
    if host in _METADATA_HOSTS:
        raise Conflict("ollama_base_url must not target a cloud metadata host")
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        address = None
    alternate_address = None
    if address is None:
        try:
            alternate_address = ipaddress.ip_address(socket.inet_aton(host))
        except OSError:
            pass
    checked_address = address or alternate_address
    if checked_address is not None and not checked_address.is_loopback and (
        checked_address in _METADATA_IPS
        or checked_address.is_link_local
        or checked_address.is_multicast
        or checked_address.is_unspecified
        or checked_address.is_reserved
    ):
        raise Conflict(
            "ollama_base_url must not target link-local, multicast, "
            "unspecified, reserved, or cloud metadata addresses"
        )
    configured_hosts = os.environ.get("BRAIN2_OLLAMA_ALLOWED_HOSTS", "")
    allowed_hosts = {
        item.strip().lower().rstrip(".")
        for item in configured_hosts.split(",")
        if item.strip()
    }
    if allowed_hosts and host not in allowed_hosts:
        raise Conflict(
            "ollama_base_url host is not permitted by "
            "BRAIN2_OLLAMA_ALLOWED_HOSTS"
        )
    if not allowed_hosts and address is None and host not in _DEFAULT_OLLAMA_HOSTS:
        raise Conflict(
            "ollama_base_url hostname is not allowed by default; use localhost, "
            "a literal IP address, or add the exact hostname to "
            "BRAIN2_OLLAMA_ALLOWED_HOSTS"
        )
    return endpoint
