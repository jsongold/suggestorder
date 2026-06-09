.PHONY: help up down reset-db api web seed test stop install start

help:
	@echo "suggestorder - dev commands"
	@echo ""
	@echo "  make install    - install deps (uv + npm)"
	@echo "  make up         - start db + redis + create pgvector ext"
	@echo "  make down       - stop containers"
	@echo "  make reset-db   - wipe db, restart fresh"
	@echo "  make start      - start all services (db, redis, api, web)"
	@echo "  make api        - run API server (foreground)"
	@echo "  make web        - run Next.js dev server"
	@echo "  make seed       - seed Phase 1 fixtures (1 org / 1 store / 3 entries / 6 products)"
	@echo "  make test       - run e2e tests"
	@echo "  make stop       - kill all dev processes"

install:
	uv venv --python=3.12
	uv sync
	cd apps/api && uv venv --python=3.12 && uv sync
	cd apps/web && npm install

up:
	docker compose up -d --no-build --remove-orphans db redis
	@until docker exec suggestorder-db-1 pg_isready -U suggestorder > /dev/null 2>&1; do sleep 1; done
	docker exec suggestorder-db-1 psql -U suggestorder -c "CREATE EXTENSION IF NOT EXISTS vector;" > /dev/null

start: up
	@command -v tmux >/dev/null 2>&1 || { echo "tmux required. Install: brew install tmux"; exit 1; }
	@tmux kill-session -t suggestorder 2>/dev/null || true
	@tmux new-session -d -s suggestorder -x 200 -y 50
	@tmux send-keys -t suggestorder:0 "cd $(PWD) && make api" Enter
	@sleep 2
	@tmux new-window -t suggestorder:1 -c $(PWD)
	@tmux send-keys -t suggestorder:1 "make web" Enter
	@sleep 1
	@echo ""
	@echo "--- Services Starting ---"
	@echo "API:        http://localhost:8000"
	@echo "Web:        http://localhost:3000"
	@echo "Containers: running (db, redis)"
	@echo "---"
	@tmux attach-session -t suggestorder

down:
	docker compose down

reset-db:
	docker compose down -v
	$(MAKE) up

api:
	cd apps/api && set -a && . ../../.env && [ ! -f ../../.env.local ] || . ../../.env.local && set +a && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload

web:
	cd apps/web && npm run dev

seed:
	cd apps/api && set -a && . ../../.env && [ ! -f ../../.env.local ] || . ../../.env.local && set +a && uv run python ../../scripts/seed.py

test:
	uv run pytest tests/test_e2e.py -v

stop:
	-lsof -ti:8000 | xargs -r kill -9 2>/dev/null
	-lsof -ti:3000 | xargs -r kill -9 2>/dev/null
	-pkill -f "uvicorn main:app" 2>/dev/null
	-pkill -f "next dev" 2>/dev/null
	@echo "stopped"
