# Meridian 로컬 개발 환경
# ---------------------------------------------------------------------------
#   make up            플랫폼 기동 (의존성 시뮬 + Redis + Kafka + 관측)
#   make baseline      레거시를 띄우고 부하를 걸어 "이겨야 할 숫자"를 만든다
#   make load S=l1     당신의 서비스에 부하 걸기
#   make chaos C=c1    장애 주입
#   make dash          Grafana 열기

COMPOSE := docker compose -f platform/docker-compose.yml
S ?= l1-steady
C ?= status
RPS ?= 500
TARGET ?= http://pdp-service:8080

.PHONY: help up down restart ps logs baseline load chaos reset dash prom depsim clean

help:
	@echo "make up        - 플랫폼 기동"
	@echo "make baseline  - 레거시 기준선 측정 (첫날 여기부터)"
	@echo "make load S=l1-steady RPS=500 [TARGET=http://legacy:8080]"
	@echo "make chaos C=c1 - 장애 주입 (c1~c7, tight, peak, reset)"
	@echo "make dash      - Grafana (http://localhost:3000)"
	@echo "make down      - 전부 정지"
	@echo ""
	@echo "시나리오: l1-steady l2-cold l3-hotkey l4-spike l5-longtail l6-degraded l7-peak"

up:
	$(COMPOSE) up -d --build dependency-sim redis redpanda postgres prometheus grafana
	@echo ""
	@echo "  Grafana        http://localhost:3000"
	@echo "  Prometheus     http://localhost:9090"
	@echo "  의존성 관리     http://localhost:9001/admin"
	@echo "  의존성 트래픽   http://localhost:9000/catalog/B000000001"

down:
	$(COMPOSE) --profile all --profile tools down

restart: down up

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=100

# 첫날 과제: 레거시가 얼마나 느린지 직접 본다
baseline:
	$(COMPOSE) --profile legacy up -d --build legacy
	@sleep 5
	$(COMPOSE) --profile tools run --rm k6 run \
		-e TARGET=http://legacy:8080 -e RPS=200 -e DURATION=90s \
		/scripts/scenarios/l1-steady.js || true
	@echo ""
	@echo "이 숫자가 당신이 이겨야 할 기준선입니다. p99를 적어두세요."

load:
	$(COMPOSE) --profile tools run --rm k6 run \
		-e TARGET=$(TARGET) -e RPS=$(RPS) \
		--out experimental-prometheus-rw \
		/scripts/scenarios/$(S).js

chaos:
	@cd platform/chaos && ./gameday.sh $(C)

reset:
	@cd platform/chaos && ./gameday.sh reset

dash:
	@echo "http://localhost:3000/d/meridian-pdp-slo"
	@command -v open >/dev/null && open http://localhost:3000/d/meridian-pdp-slo || true
	@command -v xdg-open >/dev/null && xdg-open http://localhost:3000/d/meridian-pdp-slo || true

prom:
	@echo "http://localhost:9090/alerts"

depsim:
	@curl -sS http://localhost:9001/admin | python3 -m json.tool

clean:
	$(COMPOSE) --profile all --profile tools down -v --remove-orphans
