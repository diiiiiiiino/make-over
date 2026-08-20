/*
 * LegacyOrchestrator — 우리가 갈아엎으려는 그 서비스.
 * ---------------------------------------------------------------------------
 * 2019년에 작성됐고, 그 뒤로 아무도 손대고 싶어 하지 않았다.
 *
 *   - 의존 서비스 5개를 **순차 호출**한다   → p99가 합산된다
 *   - 캐시가 없다                          → 오리진이 전부 받아낸다
 *   - 타임아웃이 없다                      → 한 서비스가 멈추면 같이 멈춘다
 *   - 폴백이 없다                          → 하나가 실패하면 페이지 전체가 실패한다
 *
 * 이 서비스는 고치라고 있는 게 아니라, **이기라고** 있는 것이다.
 * 첫날 이걸 띄우고 k6를 돌려 p99를 직접 본 다음, 당신의 pdp-service로 그 숫자를 깬다.
 *
 * 의존성 없음. Java 21 소스 실행 모드로 그대로 돈다:  java LegacyOrchestrator.java
 */
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.LongAdder;

public class LegacyOrchestrator {

    static final String DEPS = System.getenv().getOrDefault("DEPENDENCY_SIM_URL", "http://localhost:9000");
    static final int PORT = Integer.parseInt(System.getenv().getOrDefault("PORT", "8080"));

    // 타임아웃을 일부러 걸지 않았다. 그래서 아래 서비스가 멈추면 이쪽도 같이 멈춘다.
    static final HttpClient CLIENT = HttpClient.newBuilder()
            .executor(Executors.newVirtualThreadPerTaskExecutor())
            .build();

    static final double[] BUCKETS = {0.005, 0.01, 0.025, 0.05, 0.1, 0.2, 0.35, 0.5, 1, 2.5, 5, 10};
    static final LongAdder[] HIST = new LongAdder[BUCKETS.length + 1];
    static final Map<String, LongAdder> OUTCOMES = new ConcurrentHashMap<>();
    static final AtomicLong SUM_NANOS = new AtomicLong();
    static final LongAdder TOTAL = new LongAdder();

    static { for (int i = 0; i < HIST.length; i++) HIST[i] = new LongAdder(); }

    public static void main(String[] args) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(PORT), 0);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.createContext("/v1/", LegacyOrchestrator::handleProduct);
        server.createContext("/actuator/health", ex -> respond(ex, 200, "{\"status\":\"UP\"}"));
        server.createContext("/actuator/prometheus", LegacyOrchestrator::handleMetrics);
        server.start();
        System.out.printf("legacy-orchestrator 기동 :%d  ->  의존 서비스 %s%n", PORT, DEPS);
        System.out.println("경고: 순차 호출 / 캐시 없음 / 타임아웃 없음 / 폴백 없음. 이걸 이기는 게 과제입니다.");
    }

    /** GET /v1/marketplaces/{marketplaceId}/products/{productId} */
    static void handleProduct(HttpExchange ex) throws IOException {
        long t0 = System.nanoTime();
        String outcome = "ok";
        try {
            String[] p = ex.getRequestURI().getPath().split("/");
            // ["", "v1", "marketplaces", "KR", "products", "B0..."]
            if (p.length != 6 || !"marketplaces".equals(p[2]) || !"products".equals(p[4])) {
                outcome = "bad_request";
                respond(ex, 400, "{\"error\":\"GET /v1/marketplaces/{marketplaceId}/products/{productId}\"}");
                return;
            }
            String market = p[3], id = p[5];

            // --- 여기가 문제의 핵심: 다섯 번을 차례대로 기다린다 ---
            String catalog   = get("catalog",   id, market);
            String pricing   = get("pricing",   id, market);
            String inventory = get("inventory", id, market);
            String delivery  = get("delivery",  id, market);
            String reviews   = get("reviews",   id, market);
            // ------------------------------------------------------

            String body = "{\"productId\":\"" + esc(id) + "\",\"marketplaceId\":\"" + esc(market) + "\""
                    + ",\"catalog\":" + catalog
                    + ",\"price\":" + pricing
                    + ",\"inventory\":" + inventory
                    + ",\"deliveryPromise\":" + delivery
                    + ",\"reviewSummary\":" + reviews
                    + ",\"degradedModules\":[]}";
            respond(ex, 200, body);

        } catch (DependencyException e) {
            // 폴백이 없다. 하나만 실패해도 페이지 전체가 죽는다.
            outcome = "dependency_failure";
            respond(ex, 503, "{\"error\":\"upstream failure\",\"dependency\":\"" + esc(e.dependency) + "\"}");
        } catch (Exception e) {
            outcome = "error";
            respond(ex, 500, "{\"error\":\"internal\"}");
        } finally {
            record(outcome, System.nanoTime() - t0);
        }
    }

    static String get(String service, String id, String market) throws DependencyException {
        try {
            HttpRequest req = HttpRequest.newBuilder()
                    .uri(URI.create(DEPS + "/" + service + "/" + id + "?marketplaceId=" + market))
                    .GET()
                    .build();   // 타임아웃 없음
            HttpResponse<String> res = CLIENT.send(req, HttpResponse.BodyHandlers.ofString());
            if (res.statusCode() != 200) throw new DependencyException(service);
            return res.body();
        } catch (DependencyException e) {
            throw e;
        } catch (Exception e) {
            throw new DependencyException(service);
        }
    }

    static class DependencyException extends Exception {
        final String dependency;
        DependencyException(String d) { super(d); this.dependency = d; }
    }

    static void record(String outcome, long nanos) {
        OUTCOMES.computeIfAbsent(outcome, k -> new LongAdder()).increment();
        SUM_NANOS.addAndGet(nanos);
        TOTAL.increment();
        double s = nanos / 1e9;
        int i = 0;
        while (i < BUCKETS.length && s > BUCKETS[i]) i++;
        HIST[i].increment();
    }

    static void handleMetrics(HttpExchange ex) throws IOException {
        StringBuilder b = new StringBuilder();
        b.append("# HELP pdp_request_duration_seconds PDP 조립 응답 시간\n");
        b.append("# TYPE pdp_request_duration_seconds histogram\n");
        long cum = 0;
        for (int i = 0; i < BUCKETS.length; i++) {
            cum += HIST[i].sum();
            b.append("pdp_request_duration_seconds_bucket{service=\"legacy\",le=\"")
             .append(BUCKETS[i]).append("\"} ").append(cum).append('\n');
        }
        cum += HIST[BUCKETS.length].sum();
        b.append("pdp_request_duration_seconds_bucket{service=\"legacy\",le=\"+Inf\"} ").append(cum).append('\n');
        b.append("pdp_request_duration_seconds_sum{service=\"legacy\"} ").append(SUM_NANOS.get() / 1e9).append('\n');
        b.append("pdp_request_duration_seconds_count{service=\"legacy\"} ").append(TOTAL.sum()).append('\n');

        b.append("# HELP pdp_requests_total 결과별 요청 수\n# TYPE pdp_requests_total counter\n");
        OUTCOMES.forEach((k, v) -> b.append("pdp_requests_total{service=\"legacy\",outcome=\"")
                .append(k).append("\"} ").append(v.sum()).append('\n'));

        // 레거시는 캐시가 없다. 히트율 0%를 정직하게 노출한다.
        b.append("# HELP pdp_cache_access_total 캐시 접근 수\n# TYPE pdp_cache_access_total counter\n");
        b.append("pdp_cache_access_total{service=\"legacy\",layer=\"none\",result=\"miss\"} ").append(TOTAL.sum()).append('\n');

        respondRaw(ex, 200, "text/plain; version=0.0.4", b.toString());
    }

    static void respond(HttpExchange ex, int code, String body) throws IOException {
        respondRaw(ex, code, "application/json", body);
    }

    static void respondRaw(HttpExchange ex, int code, String contentType, String body) throws IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        ex.getResponseHeaders().put("Content-Type", List.of(contentType));
        ex.sendResponseHeaders(code, bytes.length);
        try (OutputStream os = ex.getResponseBody()) { os.write(bytes); }
    }

    static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
}
