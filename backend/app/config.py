import os
from typing import Any, Dict, Literal
from dotenv import load_dotenv
from pydantic import BaseModel, Field

load_dotenv()

EmbeddingMode = Literal["external", "local"]


def _parse_bool(val: str | bool | None, default: bool = False) -> bool:
    if isinstance(val, bool):
        return val
    if val is None:
        return default
    return str(val).strip().lower() in ("1", "true", "yes", "on")


class AppConfig(BaseModel):
    """
    Centralized configuration for Agent Memory Hub.
    Initialized from environment variables at startup and dynamically synchronized
    with persisted overrides from the SQLite `settings` table.
    """

    # Core Storage & Model Cache Paths
    db_path: str = Field(
        default_factory=lambda: os.getenv("DB_PATH", "/data/memory.db")
    )
    local_models_dir: str = Field(
        default_factory=lambda: os.getenv("LOCAL_MODELS_DIR", "/data/models")
    )
    static_dir: str = Field(
        default_factory=lambda: os.getenv("STATIC_DIR", "/app/static")
    )

    # Reasoning, Smart Deduplication & Context Distillation LLM
    llm_base_url: str = Field(
        default_factory=lambda: os.getenv("LLM_BASE_URL", "http://9router:20128/v1").rstrip("/")
    )
    llm_api_key: str = Field(
        default_factory=lambda: os.getenv(
            "LLM_API_KEY", os.getenv("ROUTER_API_KEY", "dummy-key")
        )
    )
    fast_model: str = Field(
        default_factory=lambda: os.getenv("FAST_MODEL", "gemini-2.5-flash")
    )

    # Embedding Engine (Default: "external" -> 0 MB local model RAM overhead)
    embedding_mode: EmbeddingMode = Field(
        default_factory=lambda: (
            "local"
            if os.getenv("EMBEDDING_MODE", "external").strip().lower() == "local"
            else "external"
        )
    )
    embedding_base_url: str = Field(
        default_factory=lambda: os.getenv(
            "EMBEDDING_BASE_URL", "http://9router:20128/v1"
        ).rstrip("/")
    )
    embedding_api_key: str = Field(
        default_factory=lambda: os.getenv(
            "EMBEDDING_API_KEY", os.getenv("ROUTER_API_KEY", "dummy-key")
        )
    )
    embedding_model: str = Field(
        default_factory=lambda: os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    )
    embedding_dimension: int = Field(
        default_factory=lambda: int(os.getenv("EMBEDDING_DIMENSION", "1536"))
    )
    local_embedding_model: str = Field(
        default_factory=lambda: os.getenv(
            "LOCAL_EMBEDDING_MODEL", "intfloat/multilingual-e5-small"
        )
    )

    # Runtime Feature Flags
    enable_ingest_webhook: bool = Field(
        default_factory=lambda: _parse_bool(
            os.getenv("ENABLE_INGEST_WEBHOOK", "false"), default=False
        )
    )

    # Dual-Auth Security Credentials
    mcp_api_key: str = Field(
        default_factory=lambda: os.getenv("MCP_API_KEY", "sk-mem-hermes-secret")
    )
    dashboard_user: str = Field(
        default_factory=lambda: os.getenv("DASHBOARD_USER", "admin")
    )
    dashboard_pass: str = Field(
        default_factory=lambda: os.getenv("DASHBOARD_PASS", "admin123")
    )

    # Retrieval & Cognitive Thresholds
    dedup_cosine_threshold: float = Field(default=0.85)
    recency_decay_lambda: float = Field(default=0.03)

    # Keys allowed to be persisted and overridden via the SQLite `settings` table
    RUNTIME_MUTABLE_KEYS: tuple[str, ...] = (
        "llm_base_url",
        "llm_api_key",
        "fast_model",
        "embedding_mode",
        "embedding_base_url",
        "embedding_api_key",
        "embedding_model",
        "embedding_dimension",
        "local_embedding_model",
        "enable_ingest_webhook",
    )

    def apply_db_overrides(self, db_settings: Dict[str, str]) -> None:
        """
        Applies persisted key-value pairs from the SQLite `settings` table
        onto the live configuration instance.
        """
        if "llm_base_url" in db_settings and db_settings["llm_base_url"].strip():
            self.llm_base_url = db_settings["llm_base_url"].strip().rstrip("/")
        if "llm_api_key" in db_settings and db_settings["llm_api_key"].strip():
            self.llm_api_key = db_settings["llm_api_key"].strip()
        if "fast_model" in db_settings and db_settings["fast_model"].strip():
            self.fast_model = db_settings["fast_model"].strip()
        if "embedding_mode" in db_settings:
            mode_val = db_settings["embedding_mode"].strip().lower()
            if mode_val in ("external", "local"):
                self.embedding_mode = mode_val  # type: ignore[assignment]
        if (
            "embedding_base_url" in db_settings
            and db_settings["embedding_base_url"].strip()
        ):
            self.embedding_base_url = (
                db_settings["embedding_base_url"].strip().rstrip("/")
            )
        if (
            "embedding_api_key" in db_settings
            and db_settings["embedding_api_key"].strip()
        ):
            self.embedding_api_key = db_settings["embedding_api_key"].strip()
        if "embedding_model" in db_settings and db_settings["embedding_model"].strip():
            self.embedding_model = db_settings["embedding_model"].strip()
        if "embedding_dimension" in db_settings:
            try:
                dim = int(db_settings["embedding_dimension"])
                if dim > 0:
                    self.embedding_dimension = dim
            except ValueError:
                pass
        if (
            "local_embedding_model" in db_settings
            and db_settings["local_embedding_model"].strip()
        ):
            self.local_embedding_model = db_settings["local_embedding_model"].strip()
        if "enable_ingest_webhook" in db_settings:
            self.enable_ingest_webhook = _parse_bool(
                db_settings["enable_ingest_webhook"],
                default=self.enable_ingest_webhook,
            )

    def to_public_dict(self, mask_secrets: bool = True) -> Dict[str, Any]:
        """
        Serializes current runtime configuration for the Dashboard Settings API.
        Masks API keys when `mask_secrets=True`.
        """
        def _mask(secret: str) -> str:
            if not secret:
                return ""
            if len(secret) <= 6:
                return "***"
            return f"{secret[:3]}...{secret[-3:]}"

        return {
            "db_path": self.db_path,
            "local_models_dir": self.local_models_dir,
            "llm_base_url": self.llm_base_url,
            "llm_api_key": _mask(self.llm_api_key) if mask_secrets else self.llm_api_key,
            "llm_api_key_configured": bool(self.llm_api_key),
            "fast_model": self.fast_model,
            "embedding_mode": self.embedding_mode,
            "embedding_base_url": self.embedding_base_url,
            "embedding_api_key": (
                _mask(self.embedding_api_key)
                if mask_secrets
                else self.embedding_api_key
            ),
            "embedding_api_key_configured": bool(self.embedding_api_key),
            "embedding_model": self.embedding_model,
            "embedding_dimension": self.embedding_dimension,
            "local_embedding_model": self.local_embedding_model,
            "enable_ingest_webhook": self.enable_ingest_webhook,
            "dedup_cosine_threshold": self.dedup_cosine_threshold,
            "recency_decay_lambda": self.recency_decay_lambda,
        }


# Singleton configuration instance shared across the process
settings = AppConfig()
