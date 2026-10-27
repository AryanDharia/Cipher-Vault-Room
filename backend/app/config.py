import os
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    HOST: str = "127.0.0.1"
    PORT: int = 8000
    ENVIRONMENT: str = "development"
    LOG_LEVEL: str = "info"

    # Security & JWT
    JWT_SECRET_KEY: str = "insecure-default-change-me-0123456789abcdef0123456789abcdef"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480

    # CORS
    CORS_ORIGINS: str = "http://localhost:5173,http://127.0.0.1:5173"

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./vaultroom.db"

    # Room Configuration
    ROOM_CODE_EXPIRY_HOURS: int = 24
    ROOM_MAX_PARTICIPANTS: int = 20
    INACTIVE_ROOM_TIMEOUT_MINUTES: int = 60

    # AI Anomaly Guard
    ANOMALY_DETECTION_MODE: str = "hybrid"  # "synthetic_demo", "real_baseline", "hybrid"
    ANOMALY_CONTAMINATION: float = 0.05

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        extra="ignore"
    )

settings = Settings()
