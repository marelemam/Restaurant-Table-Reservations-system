jest.mock("../db", () => ({
    getPool: jest.fn(),
    query: jest.fn()
}));

jest.mock("../middleware/auth", () => ({
    requireStaffOrAdmin: (req, res, next) => {
        req.user = {
            sub: process.env.TEST_USER_ID || "staff-test-001",
            groups: [
                process.env.TEST_USER_GROUP || "Staff"
            ]
        };

        next();
    }
}));

const request = require("supertest");
const db = require("../db");

process.env.NODE_ENV = "test";

const app = require("../app");

describe("Staff Activity API", () => {
    beforeEach(() => {
        jest.clearAllMocks();

        process.env.TEST_USER_ID = "staff-test-001";
        process.env.TEST_USER_GROUP = "Staff";
    });

    test("Staff can view their own activity", async () => {
        db.query
            .mockResolvedValueOnce({
                rows: [{ total: 1 }]
            })
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        activity_id:
                            "00000000-0000-4000-8000-000000000401",
                        staff_id: "staff-test-001",
                        action: "CUSTOMER_SEATED",
                        entity_type: "seating",
                        entity_id: "seating-test-001",
                        request_id: "request-test-001",
                        timestamp: "2026-11-27T08:00:00.000Z",
                        details: {
                            tableId: "T-01"
                        }
                    }
                ]
            });

        const response = await request(app)
            .get("/api/staff/activity");

        expect(response.statusCode).toBe(200);
        expect(response.body.total).toBe(1);
        expect(response.body.count).toBe(1);
        expect(response.body.activityLogs).toHaveLength(1);

        expect(db.query.mock.calls[0][1])
            .toEqual(["staff-test-001"]);

        expect(db.query.mock.calls[1][1])
            .toEqual(["staff-test-001", 50, 0]);
    });

    test("Staff cannot view another staff member's activity", async () => {
        const response = await request(app)
            .get(
                "/api/staff/activity?staffId=another-staff-member"
            );

        expect(response.statusCode).toBe(403);

        expect(response.body.error).toBe(
            "Staff members can only view their own activity"
        );

        expect(db.query).not.toHaveBeenCalled();
    });

    test("Admin can view all staff activity", async () => {
        process.env.TEST_USER_GROUP = "Admin";

        db.query
            .mockResolvedValueOnce({
                rows: [{ total: 2 }]
            })
            .mockResolvedValueOnce({
                rowCount: 2,
                rows: [
                    {
                        activity_id:
                            "00000000-0000-4000-8000-000000000402",
                        staff_id: "staff-test-001",
                        action: "CUSTOMER_SEATED",
                        entity_type: "seating"
                    },
                    {
                        activity_id:
                            "00000000-0000-4000-8000-000000000403",
                        staff_id: "staff-test-002",
                        action: "CUSTOMER_CHECKED_OUT",
                        entity_type: "seating"
                    }
                ]
            });

        const response = await request(app)
            .get("/api/staff/activity");

        expect(response.statusCode).toBe(200);
        expect(response.body.total).toBe(2);

        expect(db.query.mock.calls[0][1]).toEqual([]);
        expect(db.query.mock.calls[1][1]).toEqual([50, 0]);
    });

    test("Activity can be filtered and paginated", async () => {
        db.query
            .mockResolvedValueOnce({
                rows: [{ total: 1 }]
            })
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        staff_id: "staff-test-001",
                        action: "CUSTOMER_SEATED",
                        entity_type: "seating"
                    }
                ]
            });

        const response = await request(app)
            .get(
                "/api/staff/activity" +
                "?action=CUSTOMER_SEATED" +
                "&entityType=seating" +
                "&limit=10" +
                "&offset=5"
            );

        expect(response.statusCode).toBe(200);
        expect(response.body.limit).toBe(10);
        expect(response.body.offset).toBe(5);

        expect(db.query.mock.calls[0][1]).toEqual([
            "staff-test-001",
            "CUSTOMER_SEATED",
            "seating"
        ]);

        expect(db.query.mock.calls[1][1]).toEqual([
            "staff-test-001",
            "CUSTOMER_SEATED",
            "seating",
            10,
            5
        ]);
    });

    test("Invalid pagination is rejected", async () => {
        const response = await request(app)
            .get("/api/staff/activity?limit=500");

        expect(response.statusCode).toBe(400);
        expect(response.body.error).toBe("Validation failed");
        expect(db.query).not.toHaveBeenCalled();
    });
});