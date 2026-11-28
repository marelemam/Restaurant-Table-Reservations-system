jest.mock("../db", () => ({
    getPool: jest.fn()
}));

jest.mock("../services/eventPublisher", () => ({
    publishStaffEvent: jest.fn()
}));

const db = require("../db");
const {
    publishStaffEvent
} = require("../services/eventPublisher");
const {
    processScheduledNoShow
} = require("../jobs/processScheduledNoShow");

describe("EventBridge scheduled no-show processing", () => {
    let mockClient;

    beforeEach(() => {
        jest.clearAllMocks();

        mockClient = {
            query: jest.fn(),
            release: jest.fn()
        };

        db.getPool.mockReturnValue({
            connect: jest.fn().mockResolvedValue(mockClient)
        });

        publishStaffEvent.mockResolvedValue({
            published: true
        });
    });

    test("marks an overdue reservation as no-show", async () => {
        mockClient.query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({
                rowCount: 0,
                rows: []
            })
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        attendance_id:
                            "00000000-0000-4000-8000-000000000501",
                        reservation_id:
                            "reservation-eventbridge-test",
                        attendance_status: "no_show"
                    }
                ]
            })
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({});

        const result = await processScheduledNoShow({
            action: "PROCESS_RESERVATION_NO_SHOW",
            reservationId:
                "reservation-eventbridge-test",
            scheduledStartTime:
                "2026-01-01T10:00:00.000Z",
            graceMinutes: 15
        });

        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(200);
        expect(body.processed).toBe(true);
        expect(body.attendanceEvent.attendance_status)
            .toBe("no_show");

        expect(publishStaffEvent).toHaveBeenCalledWith(
            "RESERVATION_AUTOMATICALLY_MARKED_NO_SHOW",
            expect.objectContaining({
                reservationId:
                    "reservation-eventbridge-test"
            })
        );

        expect(mockClient.release).toHaveBeenCalled();
    });

    test("does not duplicate existing attendance", async () => {
        mockClient.query
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({})
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [
                    {
                        attendance_status: "checked_in"
                    }
                ]
            })
            .mockResolvedValueOnce({});

        const result = await processScheduledNoShow({
            reservationId:
                "reservation-already-checked-in",
            scheduledStartTime:
                "2026-01-01T10:00:00.000Z",
            graceMinutes: 15
        });

        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(200);
        expect(body.processed).toBe(false);
        expect(body.attendanceStatus)
            .toBe("checked_in");
        expect(publishStaffEvent)
            .not.toHaveBeenCalled();
    });

    test("does not process a reservation before it is due", async () => {
        const futureTime = new Date(
            Date.now() + 60 * 60 * 1000
        ).toISOString();

        const result = await processScheduledNoShow({
            reservationId: "reservation-future",
            scheduledStartTime: futureTime,
            graceMinutes: 15
        });

        const body = JSON.parse(result.body);

        expect(result.statusCode).toBe(200);
        expect(body.processed).toBe(false);
        expect(db.getPool).not.toHaveBeenCalled();
    });

    test("rejects missing reservation data", async () => {
        const result = await processScheduledNoShow({
            action: "PROCESS_RESERVATION_NO_SHOW"
        });

        expect(result.statusCode).toBe(400);
        expect(db.getPool).not.toHaveBeenCalled();
    });
});