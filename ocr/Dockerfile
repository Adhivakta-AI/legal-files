FROM ghcr.io/astral-sh/uv:0.12.1 AS uv

FROM python:3.11-slim-bookworm

COPY --from=uv /uv /uvx /bin/

ARG GIT_COMMIT=unknown

ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    GIT_COMMIT=${GIT_COMMIT}

RUN apt-get update \
    && apt-get install --yes --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        tesseract-ocr \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project

COPY src ./src
RUN uv sync --frozen --no-dev

ENTRYPOINT ["uv", "run", "--no-sync", "judgment-ocr"]
CMD ["--help"]
