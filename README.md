# Braske Plan

Apartment planning and renovation estimation project.

## Structure

- `app/` - browser-based planner prototype
- `backend/` - Django + DRF backend scaffold managed with `uv`
- `design/` - archived interaction sketches and reference prototypes
- `docs/` - architecture and product notes
- `scripts/` - small project utilities

## Frontend Development

### 1. Prepare local frontend environment

```sh
cd app
corepack pnpm install
```

### 2. Start the Vite dev server

```sh
cd app
corepack pnpm dev
```

Alternate port:

```sh
cd app
corepack pnpm dev -- --host 127.0.0.1 --port 8080 --strictPort
```

Frontend default:

- `http://127.0.0.1:4173`

## Prerequisites

Install these tools first:

- Docker Desktop
- Python 3.10+
- `uv`
- Node.js 20+ with Corepack enabled

## Backend Development

### 1. Prepare backend environment

```sh
cd backend
uv sync
cp .env.example .env
```

### 2. Optional: install local git hooks

If you want Ruff to run automatically before local commits:

```sh
cd backend
uv run pre-commit install
```

### 3. Start the backend with Docker Compose

This is the default backend development flow.

```sh
docker compose build
docker compose up --watch
```

### 4. Alternative: run the backend locally with `uv`

Use this if you explicitly want a non-Docker backend process.

```sh
cd backend
uv run python manage.py migrate
uv run python manage.py runserver
```

### 5. Optional: create a Django admin user

```sh
cd backend
uv run python manage.py createsuperuser
```

Admin:

- `http://127.0.0.1:8000/admin/`

### 6. Frontend during backend development

The frontend stays outside Docker and runs with Vite.

```sh
cd app
corepack pnpm install
corepack pnpm dev
```
The backend container uses Docker Compose `watch` so source edits are synced into the running container, while dependency changes trigger a rebuild.

### Backend defaults

- API base: `http://127.0.0.1:8000`
- Django admin: `http://127.0.0.1:8000/admin/`
- PostgreSQL: `localhost:5432`
