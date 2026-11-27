const express = require("express");
const { body, validationResult } = require("express-validator");
const { randomUUID } = require("crypto");

const { getPool, query } = require("../db");
const { requireStaffOrAdmin } = require("../middleware/auth");

const router = express.Router();

function attendanceValidators() {
    return [
        body("reservationId")
            .trim()
            .isLength({ min: 1, max: 100 })
            .withMessage("Reservation ID is required"),

        body("notes")
            .optional()
            .trim()
            .isLength({ max: 500 })
            .withMessage("Notes cannot exceed 500 characters")
    ];
}

function hasValidationErrors(req, res) {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        res.status(400).json({
            error: "Validation failed",
            details: errors.array()
        });

        return true;
    }

    return false;
}

async function createAttendanceRecord(
    req,
    res,
    next,
    {
        attendanceStatus,
        activityAction,
        responseMessage,
        extraDetails = {}
    }
) {
    const {
        reservationId,
        notes
    } = req.body;

    const staffId = req.user.sub;
    const requestId = req.get("x-request-id") || randomUUID();

    const client = await getPool().connect();

    try {
        await client.query("BEGIN");

        const insertResult = await client.query(
            `
            INSERT INTO staff_operations.attendance_events (
                reservation_id,
                attendance_status,
                recorded_by,
                notes
            )
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [
                reservationId,
                attendanceStatus,
                staffId,
                notes || null
            ]
        );

        const attendanceRecord = insertResult.rows[0];

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
                $2,
                'reservation',
                $3,
                $4,
                $5::JSONB
            )
            `,
            [
                staffId,
                activityAction,
                reservationId,
                requestId,
                JSON.stringify({
                    attendanceStatus,
                    notes: notes || null,
                    ...extraDetails
                })
            ]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            message: responseMessage,
            attendance: attendanceRecord
        });
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(409).json({
                error:
                    "Attendance has already been recorded for this reservation"
            });
        }

        next(error);
    } finally {
        client.release();
    }
}

router.post(
    "/check-ins",
    requireStaffOrAdmin,
    attendanceValidators(),
    async (req, res, next) => {
        if (hasValidationErrors(req, res)) {
            return;
        }

        await createAttendanceRecord(req, res, next, {
            attendanceStatus: "checked_in",
            activityAction: "CUSTOMER_CHECKED_IN",
            responseMessage: "Customer checked in successfully"
        });
    }
);

router.post(
    "/no-shows",
    requireStaffOrAdmin,
    [
        ...attendanceValidators(),

        body("scheduledStartTime")
            .isISO8601()
            .withMessage(
                "Scheduled start time must be a valid ISO date and time"
            )
            .toDate()
    ],
    async (req, res, next) => {
        if (hasValidationErrors(req, res)) {
            return;
        }

        const gracePeriodMinutes =
            Number(process.env.NO_SHOW_GRACE_MINUTES || 15);

        const scheduledStartTime =
            new Date(req.body.scheduledStartTime);

        const eligibleAt = new Date(
            scheduledStartTime.getTime() +
            gracePeriodMinutes * 60 * 1000
        );

        if (new Date() < eligibleAt) {
            return res.status(409).json({
                error:
                    "Reservation cannot be marked as a no-show before the grace period ends",
                eligibleAt: eligibleAt.toISOString()
            });
        }

        await createAttendanceRecord(req, res, next, {
            attendanceStatus: "no_show",
            activityAction: "RESERVATION_MARKED_NO_SHOW",
            responseMessage: "Reservation marked as a no-show",
            extraDetails: {
                scheduledStartTime:
                    scheduledStartTime.toISOString(),
                gracePeriodMinutes
            }
        });
    }
);

router.get(
    "/",
    requireStaffOrAdmin,
    async (req, res, next) => {
        const date = req.query.date || null;

        if (
            date !== null &&
            !/^\d{4}-\d{2}-\d{2}$/.test(date)
        ) {
            return res.status(400).json({
                error: "Date must use YYYY-MM-DD format"
            });
        }

        try {
            const result = await query(
                `
                SELECT
                    attendance_id,
                    reservation_id,
                    attendance_status,
                    recorded_by,
                    recorded_at,
                    notes
                FROM staff_operations.attendance_events
                WHERE (
                    $1::DATE IS NULL
                    OR recorded_at::DATE = $1::DATE
                )
                ORDER BY recorded_at DESC
                `,
                [date]
            );

            return res.status(200).json({
                count: result.rowCount,
                attendance: result.rows
            });
        } catch (error) {
            next(error);
        }
    }
);

module.exports = router;