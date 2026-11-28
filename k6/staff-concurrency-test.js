import http from "k6/http";
import { check, sleep } from "k6";

const targetVus = Number(__ENV.TARGET_VUS || 200);
const baseUrl = __ENV.BASE_URL || "http://localhost:3002";
const accessToken = __ENV.ACCESS_TOKEN || "";

export const options = {
    scenarios: {
        staff_analytics: {
            executor: "ramping-vus",
            startVUs: 0,
            stages: [
                { duration: __ENV.RAMP_UP || "20s", target: targetVus },
                { duration: __ENV.STEADY || "1m", target: targetVus },
                { duration: __ENV.RAMP_DOWN || "20s", target: 0 }
            ],
            gracefulRampDown: "10s"
        }
    },
    thresholds: {
        checks: ["rate>0.95"],
        http_req_failed: ["rate<0.05"],
        http_req_duration: ["p(95)<2000"]
    }
};

export default function () {
    const headers = { Accept: "application/json" };

    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    const response = http.get(
        `${baseUrl}/api/staff/analytics/daily`,
        {
            headers,
            timeout: __ENV.REQUEST_TIMEOUT || "10s",
            tags: { endpoint: "staff-analytics-daily" }
        }
    );

    check(response, {
        "analytics returned 200": (result) => result.status === 200,
        "response is JSON": (result) => {
            const contentType = result.headers["Content-Type"] || "";

            if (!contentType.toLowerCase().includes("application/json")) {
                return false;
            }

            try {
                result.json();
                return true;
            } catch {
                return false;
            }
        }
    });

    sleep(Number(__ENV.THINK_TIME_SECONDS || 1));
}
