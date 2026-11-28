const request = require("supertest");
const app = require("../app");

describe("Staff Operations health endpoint", () => {
    beforeEach(() => {
        process.env.ALLOWED_ORIGINS =
            "http://localhost:5500,http://localhost:4566";
    });

    test("GET /health returns service status", async () => {
        const response = await request(app).get("/health");

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("ok");
        expect(response.body.service).toBe("staff-operations");
        expect(response.body.owner).toBe("Maria");
    });

    test("allows the configured dashboard origin", async () => {
        const response = await request(app)
            .get("/health")
            .set("Origin", "http://localhost:4566");

        expect(response.headers["access-control-allow-origin"])
            .toBe("http://localhost:4566");
    });

    test("does not grant CORS access to an untrusted origin", async () => {
        const response = await request(app)
            .get("/health")
            .set("Origin", "https://untrusted.example");

        expect(response.headers["access-control-allow-origin"])
            .toBeUndefined();
    });
});
