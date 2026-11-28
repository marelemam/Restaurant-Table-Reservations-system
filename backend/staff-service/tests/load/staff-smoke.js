import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
    vus: 1,
    duration: "30s",

    thresholds: {
        http_req_failed: ["rate<0.01"],
        http_req_duration: ["p(95)<1000"],
        checks: ["rate>0.99"]
    }
};

export default function () {
    const response = http.get(
        "http://localhost:3002/health"
    );

    check(response, {
        "status is 200": (result) => result.status === 200,
        "service is healthy": (result) =>
            result.json("status") === "ok"
    });

    sleep(1);
}