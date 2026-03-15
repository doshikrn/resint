from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Inventory API"
    app_env: str = "development"
    service_version: str = "1.0.0"
    build_sha: str = "dev"
    jwt_secret: str
    jwt_alg: str = "HS256"
    cors_allow_origins: str = ""
    expose_stacktrace: bool = False
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 14
    idempotency_key_ttl_hours: int = 48
    database_url: str = "sqlite:///./inventory.db"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()