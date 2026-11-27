jest.mock("../db", () => ({
    getPool: jest.fn(),
    query: jest.fn()
}));

const request = require("supertest");
const db = require("../db");

process.env.NODE_ENV = "test";
process.env.DEV_AUTH_BYPASS = "true";

const app = require("../app");

const WAITLIST_ID =
    "4b234ed0-c1ac-49c3-80e4-7f6f30fafb0b";

const SEATING_ID =
    "7a2b3c4d-1234-4abc-8def-1234567890ab";

describe("Seating API", () => {
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

    test("POST creates a seating session", async () => {
        mockClient.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // Advisory table lock
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        waitlist_id: WAITLIST_ID,
                        status: "waiting"
                    }
                ]
            })
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        seating_id: SEATING_ID,
                        reservation_id: null,
                        waitlist_id: WAITLIST_ID,
                        table_id: "T-TEST-99",
                        status: "seated",
                        recorded_by: "development-staff"
                    }
                ]
            })
            .mockResolvedValueOnce({}) // Update waitlist
            .mockResolvedValueOnce({}) // Activity log
            .mockResolvedValueOnce({}); // COMMIT

        const response = await request(app)
            .post("/api/staff/seating")
            .send({
                waitlistId: WAITLIST_ID,
                tableId: "T-TEST-99"
            });

        expect(response.statusCode).toBe(201);

        expect(response.body.message)
            .toBe("Customer seated successfully");

        expect(response.body.seating.status)
            .toBe("seated");

        expect(response.body.seating.table_id)
            .toBe("T-TEST-99");

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("POST rejects a request without a reservation or waitlist ID", async () => {
        const response = await request(app)
            .post("/api/staff/seating")
            .send({
                tableId: "T-TEST-99"
            });

        expect(response.statusCode).toBe(400);

        expect(response.body.error)
            .toBe("Provide exactly one of reservationId or waitlistId");

        expect(db.getPool).not.toHaveBeenCalled();
    });

    test("POST prevents seating at an occupied table", async () => {
        const duplicateError = new Error(
            "Duplicate active table"
        );

        duplicateError.code = "23505";

        mockClient.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // Advisory table lock
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        waitlist_id: WAITLIST_ID,
                        status: "waiting"
                    }
                ]
            })
            .mockRejectedValueOnce(duplicateError)
            .mockResolvedValueOnce({}); // ROLLBACK

        const response = await request(app)
            .post("/api/staff/seating")
            .send({
                waitlistId: WAITLIST_ID,
                tableId: "T-OCCUPIED"
            });

        expect(response.statusCode).toBe(409);

        expect(response.body.error).toBe(
            "The table, reservation or waitlist entry already has an active seating session"
        );

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("PATCH transfers an active seating session", async () => {
        mockClient.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({}) // Advisory destination lock
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        seating_id: SEATING_ID,
                        table_id: "T-TEST-99",
                        status: "seated"
                    }
                ]
            })
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        seating_id: SEATING_ID,
                        table_id: "T-TEST-100",
                        status: "seated"
                    }
                ]
            })
            .mockResolvedValueOnce({}) // Activity log
            .mockResolvedValueOnce({}); // COMMIT

        const response = await request(app)
            .patch(
                `/api/staff/seating/${SEATING_ID}/transfer`
            )
            .send({
                newTableId: "T-TEST-100"
            });

        expect(response.statusCode).toBe(200);

        expect(response.body.message)
            .toBe("Customer transferred successfully");

        expect(response.body.seating.table_id)
            .toBe("T-TEST-100");

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("PATCH checks out an active seating session", async () => {
        mockClient.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        seating_id: SEATING_ID,
                        table_id: "T-TEST-100",
                        status: "seated"
                    }
                ]
            })
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        seating_id: SEATING_ID,
                        table_id: "T-TEST-100",
                        status: "checked_out",
                        checkout_at: "2026-11-27T08:00:00.000Z"
                    }
                ]
            })
            .mockResolvedValueOnce({}) // Activity log
            .mockResolvedValueOnce({}); // COMMIT

        const response = await request(app)
            .patch(
                `/api/staff/seating/${SEATING_ID}/checkout`
            );

        expect(response.statusCode).toBe(200);

        expect(response.body.message)
            .toBe("Customer checked out successfully");

        expect(response.body.seating.status)
            .toBe("checked_out");

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("PATCH prevents duplicate checkout", async () => {
        mockClient.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        seating_id: SEATING_ID,
                        table_id: "T-TEST-100",
                        status: "checked_out"
                    }
                ]
            })
            .mockResolvedValueOnce({}); // ROLLBACK

        const response = await request(app)
            .patch(
                `/api/staff/seating/${SEATING_ID}/checkout`
            );

        expect(response.statusCode).toBe(409);

        expect(response.body.error)
            .toBe("This seating session is not active");

        expect(response.body.currentStatus)
            .toBe("checked_out");

        expect(mockClient.release).toHaveBeenCalled();
    });
});