from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env"), extra="ignore")

    api_port: int = 8000
    demo_random_seed: int = 42
    cors_origins: str = "http://localhost:3000"

    # Demo timing (real seconds). The modeled event is 120 minutes; the demo compresses it.
    demo_telemetry_interval_seconds: float = 1.0
    demo_action_latency_seconds: float = 2.5
    demo_verify_settle_seconds: float = 4.0
    demo_event_hold_seconds: float = 40.0
    demo_restore_stage_seconds: float = 3.0

    # Microsoft Foundry (policy interpretation only)
    foundry_endpoint: str = ""
    foundry_api_key: str = ""
    foundry_model_deployment: str = "gpt-4.1"
    foundry_api_version: str = "2024-10-21"

    @property
    def foundry_configured(self) -> bool:
        return bool(self.foundry_endpoint and self.foundry_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
