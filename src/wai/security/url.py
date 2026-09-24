"""URL validation helpers for SSRF prevention."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

_LOCAL_NAMES = ("localhost", "localhost.localdomain", "ip6-localhost", "ip6-loopback")

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def _is_blocked_ip(ip: IPAddress) -> bool:
    """True for anything that is not a public unicast address.

    Covers private, loopback, link-local (incl. cloud metadata 169.254.169.254),
    reserved, unspecified, shared (100.64/10), documentation, and multicast ranges.
    IPv4-mapped IPv6 addresses are checked as their IPv4 form.
    """
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # is_global is False for private/loopback/link-local/reserved/unspecified/shared
    # ranges; multicast must be checked explicitly.
    return not ip.is_global or ip.is_multicast


def resolve_host_ips(host: str) -> list[IPAddress]:
    """Resolve ``host`` to all of its IP addresses. Raises ValueError when it cannot be resolved."""
    h = host.strip().strip("[]")
    try:
        return [ipaddress.ip_address(h)]
    except ValueError:
        pass
    try:
        infos = socket.getaddrinfo(h, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError, OSError) as exc:
        raise ValueError(f"url host could not be resolved: {host}") from exc
    ips: list[IPAddress] = []
    for info in infos:
        addr = str(info[4][0]).split("%", 1)[0]  # drop IPv6 zone id
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if ip not in ips:
            ips.append(ip)
    if not ips:
        raise ValueError(f"url host could not be resolved: {host}")
    return ips


def is_private_host(host: str, *, resolve: bool = True) -> bool:
    """Return True when host is, or resolves to, a non-public address.

    With ``resolve`` (default) hostnames are looked up via DNS and every returned
    address is checked; an unresolvable hostname is treated as not private here
    (``validate_http_url`` rejects it separately).
    """
    h = (host or "").strip().strip("[]").rstrip(".").lower()
    if h in _LOCAL_NAMES or h.endswith(".localhost"):
        return True
    try:
        return _is_blocked_ip(ipaddress.ip_address(h))
    except ValueError:
        pass
    if not resolve:
        return False
    try:
        ips = resolve_host_ips(h)
    except ValueError:
        return False
    return any(_is_blocked_ip(ip) for ip in ips)


def validate_http_url(url: str, *, allow_private: bool = False, resolve: bool = True) -> str:
    """Validate an HTTP(S) URL. Returns normalized URL or raises ValueError.

    With ``resolve=False`` only literal addresses and localhost names are checked.
    Unless ``allow_private`` is set, the host is resolved via DNS and rejected when
    any resolved address is private/loopback/link-local/reserved, or when it does not
    resolve at all. Note: this does not pin the resolved IP for the later request, so
    DNS rebinding between check and use is not prevented.
    """
    if not url or not url.strip():
        raise ValueError("url is required")
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        raise ValueError("url must use http or https")
    if not parsed.hostname:
        raise ValueError("url must include a host")
    if parsed.scheme == "http" and parsed.hostname not in ("localhost", "127.0.0.1") and not allow_private:
        raise ValueError("url must use https (http is only allowed for localhost)")
    if not allow_private:
        if is_private_host(parsed.hostname, resolve=False):
            raise ValueError("url must not point to a private address")
        if resolve:
            ips = resolve_host_ips(parsed.hostname)
            if any(_is_blocked_ip(ip) for ip in ips):
                raise ValueError("url must not point to a private address")
    return url.strip()
