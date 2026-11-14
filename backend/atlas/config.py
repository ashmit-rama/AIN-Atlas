"""Backend-only configuration. ADC is resolved lazily by the Google SDKs."""

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ATLAS_", env_file=".env", extra="ignore")
    project_id: str = ""
    location: str = ""
    model: str = ""
    gcs_bucket: str = ""
    firestore_database: str = "(default)"
    firestore_prefix: str = "atlas"
    max_upload_bytes: int = Field(default=20 * 1024 * 1024, ge=1024, le=50 * 1024 * 1024)
    max_pdf_pages: int = Field(default=100, ge=1, le=300)
    max_extracted_chars: int = Field(default=1000000, ge=1000, le=2000000)
    max_model_calls: int = Field(default=12, ge=1, le=12)
    max_output_tokens: int = Field(default=4096, ge=256, le=8192)
    request_timeout_seconds: int = Field(default=120, ge=10, le=300)
    max_retries: int = Field(default=1, ge=0, le=1)
    max_revision_rounds: int = Field(default=1, ge=0, le=1)
    max_concurrency: int = Field(default=1, ge=1, le=2)
    max_eval_cases: int = Field(default=3, ge=1, le=15)
    frontend_dist: str = "../frontend/dist"

    def missing(self, model: bool = False) -> list[str]:
        keys = ["project_id", "gcs_bucket"]
        if model:
            keys += ["location", "model"]
        return [f"ATLAS_{key.upper()}" for key in keys if not getattr(self, key).strip()]

    def public_status(self) -> dict:
        missing = self.missing(model=True)
        return {
            "configured": not missing,
            "missing": missing,
            "message": (
                "Set the listed backend environment variables and configure Google Application Default Credentials."
                if missing
                else "Configuration supplied. Live Google access has not been verified."
            ),
            "limits": {
                "max_upload_bytes": self.max_upload_bytes,
                "max_model_calls": self.max_model_calls,
                "max_output_tokens": self.max_output_tokens,
                "max_eval_cases": self.max_eval_cases,
            },
        }
