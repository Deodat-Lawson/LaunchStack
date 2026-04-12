COMPOSE := docker compose --env-file .env

.PHONY: up up-prod down down-clean logs

up:
	$(COMPOSE) up --build

up-prod:
	$(COMPOSE) up --build -d

down:
	$(COMPOSE) down

down-clean:
	$(COMPOSE) down -v

logs:
	$(COMPOSE) logs -f
