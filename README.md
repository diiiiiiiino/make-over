# Meridian — 가상 이커머스 회사 시뮬레이션

> **아마존 규모의 가상 이커머스 회사에서, 당신은 백엔드 개발자다.**
> 대표·기획자·디자이너·SRE·QA·CS·물류 담당자가 실제처럼 요구사항을 내고, 당신은 그것을 구현한다.
> 트래픽 가정도 실제 규모다 — 평상시 420k RPS, 피크 1.1M RPS.

## 이게 뭔가요

가상 회사 **Meridian**(21개국 마켓플레이스, 7.2억 SKU, 연 GMV $610B)의 **Product Detail Platform 팀** 소속 SDE II로 일하는 롤플레이 개발 시뮬레이션입니다.

- **당신** = 개발자. 요구사항을 읽고, 질문하고, 반론하고, 직접 구현한다.
- **Claude** = 나머지 전원. CEO 한지우, PM 서지훈, 디자이너 이서연, Principal Engineer Priya, SRE Diego, QA 박하늘, CS 정유진 … 이들이 요구사항을 내고 리뷰하고 장애를 터뜨린다.

기술 스택은 **Java 21 + Spring Boot 3.4**로 확정돼 있습니다.

## 시작하기

```
1. company/05-simulation-guide.md   ← 먼저 읽으세요. 진행 명령어가 있습니다
2. company/02-scale-and-traffic.md  ← 모든 설계의 전제. 이 숫자가 난이도입니다
3. meetings/2026-08-18-sprint-01-kickoff.md  ← Sprint 1이 여기서 시작됐습니다
4. backlog/sprint-01/PRD-001-pdp-aggregation-api.md
5. GitHub Issues에서 티켓을 가져가세요
```

그리고 대화창에 이렇게 말하면 됩니다:

```
스탠드업
서지훈에게 질문: 가격 stale 임계값이 몇 초인가요?
코드 리뷰 요청
장애 발생
```

## 구성원 시각화

**[company/office.html](company/office.html)** — 게임 화면. 구성원이 NPC로 서 있고, 걸어가서 말을 겁니다.
방향키로 이동 · ↑ 로 대화 / 사다리 · Q 로 퀘스트(스프린트 티켓) 창. 대화 끝에 나오는 명령어를 Claude에 입력하면 그 대화가 실제로 이어집니다.

**[company/team.html](company/team.html)** — 문서형 인물 카드. 직군 필터, 관심사, 요구·게이트·갈등 관계도.

## 실행 환경 (로컬 Docker)

```bash
make up          # 플랫폼 기동 — 의존성 시뮬 + Redis + Kafka + Prometheus/Grafana
make baseline    # 레거시에 부하를 걸어 "이겨야 할 숫자"를 만든다
make dash        # Grafana SLO 대시보드
make chaos C=c1  # 장애 주입
```

플랫폼팀이 주는 것과 당신이 만들 것의 경계는 **[platform/README.md](platform/README.md)** 에 있습니다.
핵심은 `dependency-sim` — 의존 서비스 5개의 지연·에러·**용량 한계**를 런타임에 주입할 수 있어서,
캐시 히트율이 떨어지면 남의 팀 서비스가 실제로 503을 뱉기 시작합니다.

당신이 만들 것은 `services/pdp-service` 하나입니다. → [계약 명세](services/pdp-service/README.md)

## 문서 구조

```
company/          회사 설정 — 조직, 사람, 트래픽 가정, 아키텍처, 프로세스
  office.html                 ⭐ 게임 화면 — NPC에게 말 걸기
  team.html                   구성원 13명 인물 카드 (필터 + 관계도)
  00-company-overview.md      회사 개요, 리더십 원칙, 문화
  01-org-and-people.md        ⭐ 구성원 페르소나 카드 (누가 무엇을 요구하는가)
  02-scale-and-traffic.md     ⭐ 트래픽·SLO·비용 제약 (모든 설계의 전제)
  03-tech-stack-and-architecture.md   Java/Spring 스택, 절대 규칙
  04-ways-of-working.md       스프린트, DoR/DoD, 코드리뷰, 온콜
  05-simulation-guide.md      ⭐ 시뮬레이션 진행 방법과 명령어
templates/        PRD / 티켓 / ADR / COE(포스트모템) 템플릿
backlog/          로드맵, 스프린트별 PRD와 티켓
meetings/         회의록 (요구사항이 실제로 나오는 자리)
platform/         ⭐ 로컬 실행 환경 (의존성 시뮬 · 관측 · 부하 테스트 · 장애 주입)
services/
  legacy-orchestrator/        비교 기준선 — 순차 호출, 캐시 없음, 폴백 없음
  pdp-service/                ⭐ 여기가 당신 자리
```

## Sprint 1 (진행 중)

**PDP Aggregation API v1** — 5개 의존 서비스를 병렬로 조립해 상품 상세 응답을 만든다.
의존성이 죽어도 페이지는 떠 있어야 하고, p99는 120ms를 넘으면 안 되며, 캐시 히트율 98.5%를 못 맞추면 남의 팀 서비스를 죽인다.

첫 번째 시험은 코드가 아닙니다. **26 SP가 배정됐는데 개인 몫은 8~10 SP입니다. 무엇을 잘라낼 것인가.**

---
*모든 회사명·인물·수치는 시뮬레이션용 허구입니다.*
