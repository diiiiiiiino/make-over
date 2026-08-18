# [PDP-2] 프로젝트 스캐폴딩 (Gradle 멀티모듈 / Spring Boot 3.4 / Java 21)

**타입**: Task ・ **SP**: 2 ・ **담당**: 나 ・ **요구자**: 김도현

## 배경
김도현: *"우리 팀 다른 서비스랑 구조를 맞춰주세요. 온콜 때 서비스마다 구조가 다르면 새벽에 못 찾아요."*

## 해야 할 일
- Gradle(Kotlin DSL) 멀티모듈 프로젝트 생성
- 권장 모듈: `pdp-api` / `pdp-domain` / `pdp-aggregation` / `pdp-cache` / `pdp-client` / `pdp-infra` / `pdp-loadtest`
  - (ADR-001 결론에 따라 조정 가능. 다르게 갈 거면 이유를 PR에 적을 것)
- Java 21, Spring Boot 3.4 설정
- 정적 분석(Spotless/Checkstyle 또는 동등물), 테스트 설정(JUnit 5, AssertJ, Testcontainers, WireMock)
- 헬스체크 `/actuator/health` (liveness/readiness 분리), Prometheus 엔드포인트
- Dockerfile (멀티스테이지, distroless 또는 동등 수준의 최소 이미지)
- `README.md`에 로컬 실행 방법

## 인수 조건
- [ ] **AC1.** `./gradlew build`가 클린 상태에서 성공한다.
- [ ] **AC2.** `pdp-domain`은 Spring 의존성이 **없다** (순수 Java).
- [ ] **AC3.** readiness는 Redis/Kafka 연결 실패 시 not-ready를, liveness는 프로세스 생존만 판단한다.
- [ ] **AC4.** 컨테이너 이미지가 non-root로 실행된다. (Noah 요구)
- [ ] **AC5.** 애플리케이션 기동 시간 ≤ 20초 (K8s 롤링 배포 속도 때문)

## 비기능 요구사항
| 항목 | 기준 |
|---|---|
| 이미지 크기 | ≤ 250MB |
| 기동 시간 | ≤ 20초 |
| JVM 옵션 | 컨테이너 인식 힙 설정 명시 |
