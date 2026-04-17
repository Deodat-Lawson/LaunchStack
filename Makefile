COMPOSE := docker compose --env-file .env
COMPOSE_FAST := $(COMPOSE) -f docker-compose.yml -f docker-compose.prebuilt.yml

.PHONY: up up-prod up-fast up-ocr down down-clean logs

# Lite stack (~400MB RAM) — no Docling OCR, uses native adapters for PDF/HTML/text
up:
	$(COMPOSE) up --build

up-prod:
	$(COMPOSE) up --build -d

# Full stack (~1.2GB RAM) — includes Docling OCR for Office docs (DOCX, PPTX, XLSX)
up-ocr:
	$(COMPOSE) --profile ocr -f docker-compose.yml -f docker-compose.ocr.yml up --build -d

# Build Next.js on host (fast, full RAM) then package into Docker
up-fast:
	SKIP_ENV_VALIDATION=1 pnpm build
	$(COMPOSE_FAST) build app migrate
	$(COMPOSE_FAST) up -d

down:
	$(COMPOSE) down --remove-orphans

down-clean:
	$(COMPOSE) down -v --remove-orphans

logs:
	$(COMPOSE) logs -f
