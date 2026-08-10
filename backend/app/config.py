from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


DATA_ROOT = Path("/home/shauray/Downloads/unemployment/indian-supreme-court-judgments")
PILOT_ROOT = DATA_ROOT / "judgment-search-pilot"


class Settings(BaseSettings):
    app_name: str = "Parcha Judgment Search API"
    environment: str = "development"
    database_url: str = Field(default="", alias="DATABASE_URL")
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    query_embedding_model: str = "BAAI/bge-small-en-v1.5"
    embedding_dimensions: int = 384

    pilot_manifest_path: Path = DATA_ROOT / "pilot" / "manifest.jsonl"
    pilot_documents_dir: Path = PILOT_ROOT / "work" / "final" / "documents"
    pilot_chunks_path: Path = PILOT_ROOT / "work" / "final" / "chunks.jsonl.gz"
    pilot_embeddings_dir: Path = PILOT_ROOT / "work" / "embeddings-gpu" / "shards"
    schema_sql_path: Path = PILOT_ROOT / "sql" / "001_schema.sql"

    default_limit: int = 10
    max_limit: int = 50
    full_text_candidate_limit: int = 80
    semantic_candidate_limit: int = 80

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: str) -> str:
        if value and not value.startswith(("postgresql://", "postgres://")):
            raise ValueError("DATABASE_URL must start with postgresql:// or postgres://")
        return value

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
