const request = require("supertest");
const app = require("../app");

describe("Staff Operations health endpoint", () => {
    test("GET /health returns service status", async () => {
        const response = await request(app).get("/health");

        expect(response.statusCode).toBe(200);
        expect(response.body.status).toBe("ok");
        expect(response.body.service).toBe("staff-operations");
        expect(response.body.owner).toBe("Maria");
    });
});