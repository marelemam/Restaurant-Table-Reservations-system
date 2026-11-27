jest.mock("../db", () => ({
    getPool: jest.fn(),
    query: jest.fn()
}));

jest.mock("../middleware/auth", () => ({
    requireStaffOrAdmin: (req, res, next) => {
        const role =
            req.get("x-test-role") === "Admin"
                ? "Admin"
                : "Staff";

        req.user = {
            sub:
                role === "Admin"
                    ? "admin-test-001"
                    : "staff-test-001",
            groups: [role]
        };

        return next();
    },

    requireAdmin: (req, res, next) => {
        req.user = {
            sub: "admin-test-001",
            groups: ["Admin"]
        };

        return next();
    }
}));

const request = require("supertest");
const db = require("../db");

process.env.NODE_ENV = "test";

const app = require("../app");

const TODAY = new Date()
    .toISOString()
    .slice(0, 10);

const analyticsRow = {
    checked_in: 4,
    no_shows: 1,
    waitlist_entries_added: 6,
    currently_waiting: 2,
    currently_notified: 1,
    average_estimated_wait_minutes: "18.50",
    customers_seated: 5,
    active_tables: 3,
    customers_checked_out: 2,
    average_dining_minutes: "62.50",
    staff_actions: 12
};

describe("Operational Analytics API", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test(
        "Staff can view today's operational analytics",
        async () => {
            db.query.mockResolvedValue({
                rowCount: 1,
                rows: [analyticsRow]
            });

            const response = await request(app)
                .get("/api/staff/analytics/daily");

            expect(response.statusCode).toBe(200);
            expect(response.body.date).toBe(TODAY);
            expect(response.body.role).toBe("Staff");

            expect(
                response.body.attendance.checkedIn
            ).toBe(4);

            expect(
                response.body.attendance.noShows
            ).toBe(1);

            expect(
                response.body.waitlist
                    .averageEstimatedWaitMinutes
            ).toBe(18.5);

            expect(
                response.body.seating
                    .averageDiningMinutes
            ).toBe(62.5);

            expect(response.body.staffActions).toBe(12);

            expect(db.query).toHaveBeenCalledWith(
                expect.stringContaining(
                    "staff_operations.attendance_events"
                ),
                [TODAY]
            );
        }
    );

    test(
        "Staff cannot view historical analytics",
        async () => {
            const response = await request(app)
                .get(
                    "/api/staff/analytics/daily" +
                    "?date=2020-01-01"
                );

            expect(response.statusCode).toBe(403);

            expect(response.body.error).toBe(
                "Staff can only view today's analytics"
            );

            expect(db.query).not.toHaveBeenCalled();
        }
    );

    test("Admin can view historical analytics", async () => {
        db.query.mockResolvedValue({
            rowCount: 1,
            rows: [analyticsRow]
        });

        const response = await request(app)
            .get(
                "/api/staff/analytics/daily" +
                "?date=2020-01-01"
            )
            .set("x-test-role", "Admin");

        expect(response.statusCode).toBe(200);
        expect(response.body.date).toBe("2020-01-01");
        expect(response.body.role).toBe("Admin");

        expect(db.query).toHaveBeenCalledWith(
            expect.any(String),
            ["2020-01-01"]
        );
    });

    test("Invalid analytics date is rejected", async () => {
        const response = await request(app)
            .get(
                "/api/staff/analytics/daily" +
                "?date=incorrect"
            );

        expect(response.statusCode).toBe(400);

        expect(response.body.error).toBe(
            "Validation failed"
        );

        expect(db.query).not.toHaveBeenCalled();
    });
});