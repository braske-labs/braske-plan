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

## Backend Development

### 1. Prepare local backend environment

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

### 3. Start PostgreSQL and the backend

Use one of these approaches.

Local backend with `uv`:

```sh
cd backend
uv run python manage.py migrate
uv run python manage.py runserver
```

Docker Compose with backend sync/watch:

```sh
docker compose build
docker compose up --watch
```

### 4. Optional: create a Django admin user

```sh
cd backend
uv run python manage.py createsuperuser
```

Admin:

- `http://127.0.0.1:8000/admin/`

### 5. Frontend during backend development

For now, the frontend stays outside Docker and runs with Vite.

- Frontend: run `cd app && corepack pnpm dev`
- Backend: run with `uv` from `backend/`, or use Docker Compose with `watch`
- Database: run through Docker Compose

This keeps the frontend fast to iterate on while the backend is still being introduced.
The backend container uses Docker Compose `watch` so source edits are synced into the running container, while dependency changes trigger a rebuild.

### Backend defaults

- API base: `http://127.0.0.1:8000`
- Django admin: `http://127.0.0.1:8000/admin/`
- PostgreSQL: `localhost:5432`
