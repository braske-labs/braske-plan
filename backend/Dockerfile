FROM ghcr.io/astral-sh/uv:python3.10-bookworm-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml .python-version ./
RUN uv sync --no-dev

COPY . .

CMD ["uv", "run", "python", "manage.py", "runserver", "0.0.0.0:8000"]
