FROM eclipse-temurin:21-jdk-alpine
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY LegacyOrchestrator.java ./
USER app
EXPOSE 8080
# Java 21 소스 실행 모드 — 빌드 도구도, 의존성도 없다
CMD ["java", "-XX:MaxRAMPercentage=75", "LegacyOrchestrator.java"]
