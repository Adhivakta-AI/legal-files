from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, field_validator, model_validator


class SearchRequest(BaseModel):
    query: str = Field(min_length=3, max_length=500)
    limit: int = Field(default=10, ge=1, le=50)
    year_from: int | None = Field(default=None, ge=1800, le=2200)
    year_to: int | None = Field(default=None, ge=1800, le=2200)

    @field_validator("query")
    @classmethod
    def normalize_query(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value) < 3:
            raise ValueError("query must contain at least 3 non-whitespace characters")
        return value

    @model_validator(mode="after")
    def validate_year_range(self) -> "SearchRequest":
        if self.year_from is not None and self.year_to is not None:
            if self.year_from > self.year_to:
                raise ValueError("year_from must be less than or equal to year_to")
        return self


class SearchResult(BaseModel):
    chunk_id: str
    judgment_id: str
    title: str
    citation: str | None = None
    decision_date: date | None = None
    judge: str | None = None
    chunk_text: str
    pdf_url: str
    pdf_page: int
    paragraph_number: str | None = None
    text_source: str
    keyword_score: float | None = None
    semantic_score: float | None = None
    rrf_score: float


class SearchResponse(BaseModel):
    query: str
    limit: int
    year_from: int | None = None
    year_to: int | None = None
    results: list[SearchResult]


class HealthResponse(BaseModel):
    status: str
