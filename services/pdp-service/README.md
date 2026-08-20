# pdp-service — 여기가 당신 자리입니다

이 디렉터리는 비어 있습니다. **PDP-2(프로젝트 스캐폴딩)부터 당신이 채웁니다.**

## 이 서비스가 만족해야 하는 계약

플랫폼(= docker-compose)은 이 서비스에 대해 딱 네 가지를 가정합니다.

| 항목 | 요구 |
|---|---|
| 포트 | `8080` |
| API | `GET /v1/marketplaces/{marketplaceId}/products/{productId}` |
| 헬스체크 | `GET /actuator/health` (liveness/readiness 분리) |
| 메트릭 | `GET /actuator/prometheus` |

주입되는 환경 변수:

```
DEPENDENCY_SIM_URL=http://dependency-sim:9000   # 의존 서비스 5개의 베이스 URL
REDIS_HOST=redis  REDIS_PORT=6379
KAFKA_BOOTSTRAP=redpanda:29092
```

## 의존 서비스 호출 규약

```
GET {DEPENDENCY_SIM_URL}/catalog/{productId}?marketplaceId=KR
GET {DEPENDENCY_SIM_URL}/pricing/{productId}?marketplaceId=KR
GET {DEPENDENCY_SIM_URL}/inventory/{productId}?marketplaceId=KR
GET {DEPENDENCY_SIM_URL}/delivery/{productId}?marketplaceId=KR
GET {DEPENDENCY_SIM_URL}/reviews/{productId}?marketplaceId=KR
```

응답 예시와 고장내는 법은 `platform/README.md`를 보세요.

## 대시보드가 기대하는 메트릭 이름

Grafana 대시보드와 SLO 알람이 아래 이름을 그대로 씁니다.
다른 이름을 쓰면 대시보드가 비어 보입니다 (그것도 배움이긴 합니다).

```
pdp_request_duration_seconds{service,marketplace,outcome}   histogram
pdp_requests_total{service,outcome}                         counter
pdp_cache_access_total{service,layer,result}                counter   layer=l1|l2|origin, result=hit|miss
pdp_degraded_total{service,module}                          counter
pdp_dependency_duration_seconds{service,dependency,outcome} histogram
pdp_price_staleness_seconds{service}                        gauge
```

Spring Boot라면 `management.metrics.tags.service=pdp` 로 공통 태그를 붙이면 됩니다.

## 컨테이너로 띄우려면

여기에 `Dockerfile`을 만들면 `docker compose --profile pdp up -d` 가 살아납니다.
`cpus: 2`, `mem_limit: 1g` 로 묶여 있습니다. **이 숫자를 늘려서 SLO를 맞추는 건 반칙입니다.**
프로덕션 인스턴스 한 대의 조건이라고 생각하세요.

## 시작 순서 (추천)

```
1. PDP-1  ADR-001 작성 → Priya 리뷰            ← 코드보다 먼저
2. PDP-2  스캐폴딩 + 이 계약 충족 (빈 응답이라도 200)
3. make load S=l1-steady TARGET=http://pdp-service:8080   ← 아무것도 없는 상태의 숫자
4. PDP-3  조립 API → 다시 측정
5. PDP-5  캐시 → 다시 측정
6. make chaos C=c1 → 폴백이 실제로 도는지 확인
```

매번 **측정 → 변경 → 재측정**입니다. 숫자 없이 "빨라졌을 것 같다"는 이 회사에서 통하지 않습니다.
