jest.mock("../db", () => ({
    getPool: jest.fn(),
    query: jest.fn()
}));

const request = require("supertest");
const db = require("../db");

process.env.NODE_ENV = "test";
process.env.DEV_AUTH_BYPASS = "true";
process.env.NO_SHOW_GRACE_MINUTES = "15";

const app = require("../app");

describe("Attendance API", () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();

        process.env.NODE_ENV = "test";
        process.env.DEV_AUTH_BYPASS = "true";
        process.env.NO_SHOW_GRACE_MINUTES = "15";

        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };

        db.getPool.mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient)
        });
    });

    function mockSuccessfulAttendanceInsert(status) {
        mockClient.query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({
                rows: [
                    {
                        attendance_id: "attendance-test-001",
                        reservation_id: "reservation-test-001",
                        attendance_status: status,
                        recorded_by: "local-development-staff"
                    }
                ]
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});
    }

    test("GET /api/staff/attendance returns records", async () => {
        db.query.mockResolvedValue({
            rowCount: 1,
            rows: [
                {
                    attendance_id: "attendance-test-001",
                    reservation_id: "reservation-test-001",
                    attendance_status: "checked_in"
                }
            ]
        });

        const response = await request(app)
            .get("/api/staff/attendance");

        expect(response.statusCode).toBe(200);
        expect(response.body.count).toBe(1);
        expect(response.body.attendance).toHaveLength(1);
    });

    test("POST check-in creates an attendance record", async () => {
        mockSuccessfulAttendanceInsert("checked_in");

        const response = await request(app)
            .post("/api/staff/attendance/check-ins")
            .send({
                reservationId: "reservation-test-001",
                notes: "Customer arrived"
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.message)
            .toBe("Customer checked in successfully");

        expect(response.body.attendance.attendance_status)
            .toBe("checked_in");

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("POST check-in prevents duplicate attendance", async () => {
        const duplicateError = new Error("Duplicate attendance");
        duplicateError.code = "23505";

        mockClient.query
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(duplicateError)
            .mockResolvedValueOnce({});

        const response = await request(app)
            .post("/api/staff/attendance/check-ins")
            .send({
                reservationId: "reservation-test-001"
            });

        expect(response.statusCode).toBe(409);
        expect(response.body.error)
            .toBe(
                "Attendance has already been recorded for this reservation"
            );

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("POST no-show rejects requests before grace period", async () => {
        const futureStartTime = new Date(
            Date.now() + 60 * 60 * 1000
        ).toISOString();

        const response = await request(app)
            .post("/api/staff/attendance/no-shows")
            .send({
                reservationId: "reservation-future-001",
                scheduledStartTime: futureStartTime
            });

        expect(response.statusCode).toBe(409);
        expect(response.body.error)
            .toContain("grace period");

        expect(db.getPool).not.toHaveBeenCalled();
    });

    test("POST no-show succeeds after grace period", async () => {
        mockSuccessfulAttendanceInsert("no_show");

        const pastStartTime = new Date(
            Date.now() - 60 * 60 * 1000
        ).toISOString();

        const response = await request(app)
            .post("/api/staff/attendance/no-shows")
            .send({
                reservationId: "reservation-test-001",
                scheduledStartTime: pastStartTime,
                notes: "Customer did not arrive"
            });

        expect(response.statusCode).toBe(201);
        expect(response.body.message)
            .toBe("Reservation marked as a no-show");

        expect(response.body.attendance.attendance_status)
            .toBe("no_show");
    });

    test("GET rejects unauthenticated requests", async () => {
        process.env.DEV_AUTH_BYPASS = "false";

        const response = await request(app)
            .get("/api/staff/attendance");

        expect(response.statusCode).toBe(401);
        expect(response.body.error)
            .toBe("Authentication required");
    });
});