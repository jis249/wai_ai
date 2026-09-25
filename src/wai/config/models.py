"""Configuration dataclasses loaded from wai.yaml."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import timedelta
from typing import Any


@dataclass
class ProxyConfig:
    port: int = 0
    read_timeout: timedelta = field(default_factory=lambda: timedelta(seconds=30))
    write_timeout: timedelta = field(default_factory=lambda: timedelta(seconds=120))
    idle_timeout: timedelta = field(default_factory=lambda: timedelta(seconds=60))
    max_request_body: int = 0
    max_response_body: int = 0
    max_stream_duration: timedelta = field(default_factory=lambda: timedelta(minutes=5))
    drain_timeout: timedelta = field(default_factory=lambda: timedelta(seconds=25))


@dataclass
class TLSConfig:
    enabled: bool = False
    cert: str = ""
    key: str = ""


@dataclass
class AdminConfig:
    port: int = 0
    tls: TLSConfig = field(default_factory=TLSConfig)


@dataclass
class ServerConfig:
    proxy: ProxyConfig = field(default_factory=ProxyConfig)
    admin: AdminConfig = field(default_factory=AdminConfig)


@dataclass
class DatabaseConfig:
    driver: str = ""
    dsn: str = ""
    max_open_conns: int = 0
    max_idle_conns: int = 0
    conn_max_lifetime: timedelta = field(default_factory=lambda: timedelta(minutes=5))


@dataclass
class CacheConfig:
    key_ttl: timedelta = field(default_factory=lambda: timedelta(seconds=30))
    model_ttl: timedelta = field(default_factory=lambda: timedelta(seconds=60))
    alias_ttl: timedelta = field(default_factory=lambda: timedelta(seconds=60))


@dataclass
class RedisConfig:
    enabled: bool = False
    url: str = ""
    key_prefix: str = ""


@dataclass
class PricingConfig:
    input_per_1m: float = 0.0
    output_per_1m: float = 0.0


@dataclass
class DeploymentConfig:
    name: str = ""
    provider: str = ""
    base_url: str = ""
    api_key: str = ""
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    weight: int = 0
    priority: int = 0


@dataclass
class ModelConfig:
    name: str = ""
    provider: str = ""
    type: str = ""
    base_url: str = ""
    api_key: str = ""
    aliases: list[str] = field(default_factory=list)
    max_context_tokens: int = 0
    pricing: PricingConfig = field(default_factory=PricingConfig)
    azure_deployment: str = ""
    azure_api_version: str = ""
    gcp_project: str = ""
    gcp_location: str = ""
    timeout: str = ""
    strategy: str = ""
    max_retries: int = 0
    fallback: str = ""
    deployments: list[DeploymentConfig] = field(default_factory=list)


@dataclass
class BootstrapConfig:
    org_name: str = ""
    org_slug: str = ""
    admin_email: str = ""


@dataclass
class UsageConfig:
    buffer_size: int = 0
    flush_interval: timedelta = field(default_factory=lambda: timedelta(seconds=5))
    drop_on_full: bool | None = None


@dataclass
class RateLimitConfig:
    login_max_attempts: int = 10
    login_window_minutes: int = 15
    invite_max_attempts: int = 5
    invite_window_minutes: int = 15


@dataclass
class AutoRouterSettings:
    enabled: bool = True
    default_model: str = "qwen3-coder:30b-gpu"
    classifier_model: str = "qwen3-coder:30b-gpu"
    classifier_timeout_seconds: float = 8.0
    complex_mode: str = "random"
    complex_model: str = ""


@dataclass
class SettingsConfig:
    admin_key: str = ""
    encryption_key: str = ""
    bootstrap: BootstrapConfig = field(default_factory=BootstrapConfig)
    usage: UsageConfig = field(default_factory=UsageConfig)
    rate_limit: RateLimitConfig = field(default_factory=RateLimitConfig)
    fallback_max_depth: int = 0
    health_check_interval_seconds: float = 60.0
    auto_router: AutoRouterSettings = field(default_factory=AutoRouterSettings)


@dataclass
class MCPServerConfig:
    name: str = ""
    alias: str = ""
    url: str = ""
    auth_type: str = ""
    auth_header: str = ""
    auth_token: str = ""
    oauth_token_url: str = ""
    oauth_client_id: str = ""
    oauth_client_secret: str = ""
    oauth_scopes: str = ""


@dataclass
class LoggingConfig:
    level: str = ""
    format: str = ""


DEFAULT_PRICING_SOURCE_URL = (
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
)


@dataclass
class PricingSyncConfig:
    """Model catalog pricing sync (LiteLLM community price list)."""

    source_url: str = DEFAULT_PRICING_SOURCE_URL
    # Air-gapped installs: read the JSON from this file instead of fetching source_url.
    local_path: str = ""
    # Daily background sync; only touches models whose pricing_source is 'synced'.
    auto_sync: bool = False
    auto_sync_interval_hours: float = 24.0
    timeout_seconds: float = 15.0
    max_bytes: int = 10 * 1024 * 1024


@dataclass
class ReliabilityConfig:
    """Proxy reliability: per-deployment circuit breakers and retry backoff."""

    circuit_enabled: bool = True
    # Open after this many consecutive failures (network error, timeout, 5xx, 429).
    circuit_failure_threshold: int = 5
    # Optional: also open when the failure rate over the rolling window reaches this
    # fraction (0 disables), once at least circuit_min_requests were seen.
    circuit_failure_rate_threshold: float = 0.0
    circuit_window_seconds: float = 60.0
    circuit_min_requests: int = 20
    # First cooldown; doubles on each re-trip without recovery, capped at the max.
    circuit_cooldown_seconds: float = 30.0
    circuit_max_cooldown_seconds: float = 300.0
    # A 429 with Retry-After opens the circuit immediately for that long (capped).
    circuit_open_on_retry_after: bool = True
    circuit_max_entries: int = 2048
    # Backoff between retry attempts: exponential with jitter.
    retry_backoff_base_ms: float = 100.0
    retry_backoff_max_ms: float = 2000.0
    # Honour an upstream Retry-After up to this many seconds; longer means move on.
    retry_after_max_seconds: float = 10.0
    # Total retry budget when the model sets no timeout (else the model timeout).
    retry_budget_seconds: float = 60.0


@dataclass
class SSOConfig:
    """Global OIDC single sign-on (e.g. Microsoft Entra ID)."""

    enabled: bool = False
    issuer: str = ""
    client_id: str = ""
    client_secret: str = ""
    redirect_url: str = ""
    scopes: list[str] = field(default_factory=list)
    allowed_domains: list[str] = field(default_factory=list)
    auto_provision: bool = False
    default_role: str = "member"
    # New SSO users join this org; it is created at startup when default_org_name is set and it is missing.
    default_org_slug: str = ""
    default_org_name: str = ""
    # Existing users still in this org are moved into default_org_slug on their next SSO login.
    migrate_from_org_slug: str = ""
    group_sync: bool = False
    group_claim: str = ""


@dataclass
class Config:
    server: ServerConfig = field(default_factory=ServerConfig)
    database: DatabaseConfig = field(default_factory=DatabaseConfig)
    cache: CacheConfig = field(default_factory=CacheConfig)
    redis: RedisConfig = field(default_factory=RedisConfig)
    models: list[ModelConfig] = field(default_factory=list)
    mcp_servers: list[MCPServerConfig] = field(default_factory=list)
    settings: SettingsConfig = field(default_factory=SettingsConfig)
    logging: LoggingConfig = field(default_factory=LoggingConfig)
    pricing: PricingSyncConfig = field(default_factory=PricingSyncConfig)
    reliability: ReliabilityConfig = field(default_factory=ReliabilityConfig)
    sso: SSOConfig = field(default_factory=SSOConfig)
