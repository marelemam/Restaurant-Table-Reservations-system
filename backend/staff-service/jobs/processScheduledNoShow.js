const { randomUUID } = require("crypto");
const { getPool } = require("../db");
const {
    publishStaffEvent
} = require("../services/eventPublisher");

function response(statusCode, body) {
    return {
        statusCode,
        body: JSON.stringify(body)
    };
}

async function processScheduledNoShow(event) {
    const reservationId = event.reservationId;
    const scheduledStartTime = event.scheduledStartTime;
    const graceMinutes = Number(event.graceMinutes ?? 15);
    const recordedBy =
        event.recordedBy || "eventbridge-scheduler";

    if (!reservationId || !scheduledStartTime) {
        return response(400, {
            error:
                "reservationId and scheduledStartTime are required"
        });
    }

    const scheduledDate = new Date(scheduledStartTime);

    if (
        Number.isNaN(scheduledDate.getTime()) ||
        !Number.isFinite(graceMinutes) ||
        graceMinutes < 0
    ) {
        return response(400, {
            error: "Invalid scheduled no-show data"
        });
    }

    const noShowTime =
        scheduledDate.getTime() + graceMinutes * 60 * 1000;

    if (Date.now() < noShowTime) {
        return response(200, {
            message: "Reservation is not overdue",
            processed: false
        });
    }

    const requestId = event.requestId || randomUUID();
    const client = await getPool().connect();

    try {
        await client.query("BEGIN");

        await client.query(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [reservationId]
        );

        const existingResult = await client.query(
            `
            SELECT attendance_status
            FROM staff_operations.attendance_events
            WHERE reservation_id = $1
              AND attendance_status IN (
                  'checked_in',
                  'no_show'
              )
            ORDER BY recorded_at DESC
            LIMIT 1
            `,
            [reservationId]
        );

        if (existingResult.rowCount > 0) {
            await client.query("COMMIT");

            return response(200, {
                message:
                    "Attendance was already recorded",
                attendanceStatus:
                    existingResult.rows[0].attendance_status,
                processed: false
            });
        }

        const attendanceResult = await client.query(
            `
            INSERT INTO staff_operations.attendance_events (
                reservation_id,
                attendance_status,
                recorded_by,
                notes
            )
            VALUES ($1, 'no_show', $2, $3)
            RETURNING *
            `,
            [
                reservationId,
                recordedBy,
                "Automatically recorded by EventBridge Scheduler"
            ]
        );

        await client.query(
            `
            INSERT INTO staff_operations.staff_activity_logs (
                staff_id,
                action,
                entity_type,
                entity_id,
                request_id,
                details
            )
            VALUES (
                $1,
                'CUSTOMER_MARKED_NO_SHOW',
                'reservation',
                $2,
                $3,
                $4::JSONB
            )
            `,
            [
                recordedBy,
                reservationId,
                requestId,
                JSON.stringify({
                    source: "eventbridge-scheduler",
                    scheduledStartTime,
                    graceMinutes
                })
            ]
        );

        await client.query("COMMIT");

        const attendanceEvent =
            attendanceResult.rows[0];

        await publishStaffEvent(
            "RESERVATION_AUTOMATICALLY_MARKED_NO_SHOW",
            {
                reservationId,
                attendanceId:
                    attendanceEvent.attendance_id,
                scheduledStartTime,
                graceMinutes
            }
        );

        return response(200, {
            message:
                "Reservation automatically marked as no-show",
            processed: true,
            attendanceEvent
        });
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    processScheduledNoShow
};