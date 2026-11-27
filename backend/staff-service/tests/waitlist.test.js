jest.mock("../db", () => ({
    getPool: jest.fn(),
    query: jest.fn()
}));

const request = require("supertest");
const db = require("../db");

process.env.NODE_ENV = "test";
process.env.DEV_AUTH_BYPASS = "true";

const app = require("../app");

describe("Waitlist API", () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();

        process.env.NODE_ENV = "test";
        process.env.DEV_AUTH_BYPASS = "true";

        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };

        db.getPool.mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient)
        });
    });

    test("GET /api/staff/waitlist returns the active queue", async () => {
        db.query.mockResolvedValue({
            rowCount: 1,
            rows: [
                {
                    waitlist_id: "waitlist-001",
                    customer_name: "Test Customer",
                    phone: "01000000003",
                    party_size: 3,
                    estimated_wait_minutes: 20,
                    status: "waiting",
                    queue_position: "1"
                }
            ]
        });

        const response = await request(app)
            .get("/api/staff/waitlist");

        expect(response.statusCode).toBe(200);
        expect(response.body.count).toBe(1);
        expect(response.body.waitlist).toHaveLength(1);
    });

    test("POST /api/staff/waitlist creates a valid entry", async () => {
        mockClient.query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({
                rows: [{ waiting_count: 2 }]
            })
            .mockResolvedValueOnce({
                rows: [
                    {
                        waitlist_id: "waitlist-002",
                        customer_name: "Test Walk-in",
                        phone: "01000000003",
                        party_size: 3,
                        estimated_wait_minutes: 30,
                        status: "waiting"
                    }
                ]
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});

        const response = await request(app)
            .post("/api/staff/waitlist")
            .send({
                customerName: "Test Walk-in",
                phone: "01000000003",
                partySize: 3
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.message)
            .toBe("Walk-in added to the waitlist");

        expect(response.body.waitlistEntry.status)
            .toBe("waiting");

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("POST rejects an invalid party size", async () => {
        const response = await request(app)
            .post("/api/staff/waitlist")
            .send({
                customerName: "Test Walk-in",
                phone: "01000000003",
                partySize: 0
            });

        expect(response.statusCode).toBe(400);
        expect(response.body.error).toBe("Validation failed");
        expect(db.getPool).not.toHaveBeenCalled();
    });

    test("GET rejects unauthenticated requests", async () => {
        process.env.DEV_AUTH_BYPASS = "false";

        const response = await request(app)
            .get("/api/staff/waitlist");

        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe("Authentication required");
        expect(db.query).not.toHaveBeenCalled();
    });
});