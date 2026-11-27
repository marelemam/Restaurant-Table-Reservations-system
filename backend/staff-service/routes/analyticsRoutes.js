const express = require("express");

const {
    query: validateQuery,
    validationResult
} = require("express-validator");

const { query: databaseQuery } = require("../db");

const {
    requireStaffOrAdmin
} = require("../middleware/auth");

const router = express.Router();

router.use(requireStaffOrAdmin);

router.get(
    "/daily",
    [
        validateQuery("date")
            .optional()
            .matches(/^\d{4}-\d{2}-\d{2}$/)
            .withMessage("date must use YYYY-MM-DD format")
            .isISO8601({ strict: true })
            .withMessage("date must be valid")
    ],
    async (req, res, next) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: "Validation failed",
                details: errors.array()
            });
        }

        const today = new Date()
            .toISOString()
            .slice(0, 10);

        const reportDate = req.query.date || today;

        const groups = req.user.groups || [];
        const isAdmin = groups.includes("Admin");

        // Staff can view today's operations.
        // Admin can also view historical dates.
        if (!isAdmin && reportDate !== today) {
            return res.status(403).json({
                error:
                    "Staff can only view today's analytics"
            });
        }

        try {
            const result = await databaseQuery(
                `SELECT
                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.attendance_events
                        WHERE recorded_at >= $1::DATE
                          AND recorded_at < $1::DATE + INTERVAL '1 day'
                          AND attendance_status = 'checked_in'
                    ) AS checked_in,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.attendance_events
                        WHERE recorded_at >= $1::DATE
                          AND recorded_at < $1::DATE + INTERVAL '1 day'
                          AND attendance_status = 'no_show'
                    ) AS no_shows,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.waitlist_entries
                        WHERE created_at >= $1::DATE
                          AND created_at < $1::DATE + INTERVAL '1 day'
                    ) AS waitlist_entries_added,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.waitlist_entries
                        WHERE status = 'waiting'
                    ) AS currently_waiting,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.waitlist_entries
                        WHERE status = 'notified'
                    ) AS currently_notified,

                    COALESCE(
                        (
                            SELECT ROUND(
                                AVG(estimated_wait_minutes)::NUMERIC,
                                2
                            )
                            FROM staff_operations.waitlist_entries
                            WHERE created_at >= $1::DATE
                              AND created_at <
                                  $1::DATE + INTERVAL '1 day'
                        ),
                        0
                    ) AS average_estimated_wait_minutes,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.seating_sessions
                        WHERE seated_at >= $1::DATE
                          AND seated_at < $1::DATE + INTERVAL '1 day'
                    ) AS customers_seated,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.seating_sessions
                        WHERE status = 'seated'
                    ) AS active_tables,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.seating_sessions
                        WHERE checkout_at >= $1::DATE
                          AND checkout_at <
                              $1::DATE + INTERVAL '1 day'
                          AND status = 'checked_out'
                    ) AS customers_checked_out,

                    COALESCE(
                        (
                            SELECT ROUND(
                                AVG(
                                    EXTRACT(
                                        EPOCH FROM
                                        (checkout_at - seated_at)
                                    ) / 60.0
                                )::NUMERIC,
                                2
                            )
                            FROM staff_operations.seating_sessions
                            WHERE checkout_at >= $1::DATE
                              AND checkout_at <
                                  $1::DATE + INTERVAL '1 day'
                              AND status = 'checked_out'
                        ),
                        0
                    ) AS average_dining_minutes,

                    (
                        SELECT COUNT(*)::INTEGER
                        FROM staff_operations.staff_activity_logs
                        WHERE timestamp >= $1::DATE
                          AND timestamp <
                              $1::DATE + INTERVAL '1 day'
                    ) AS staff_actions`,
                [reportDate]
            );

            const row = result.rows[0];

            return res.status(200).json({
                date: reportDate,
                generatedFor: req.user.sub,
                role: isAdmin ? "Admin" : "Staff",

                attendance: {
                    checkedIn: Number(row.checked_in),
                    noShows: Number(row.no_shows)
                },

                waitlist: {
                    entriesAdded:
                        Number(row.waitlist_entries_added),
                    currentlyWaiting:
                        Number(row.currently_waiting),
                    currentlyNotified:
                        Number(row.currently_notified),
                    averageEstimatedWaitMinutes:
                        Number(
                            row.average_estimated_wait_minutes
                        )
                },

                seating: {
                    customersSeated:
                        Number(row.customers_seated),
                    activeTables:
                        Number(row.active_tables),
                    customersCheckedOut:
                        Number(row.customers_checked_out),
                    averageDiningMinutes:
                        Number(row.average_dining_minutes)
                },

                staffActions:
                    Number(row.staff_actions)
            });
        } catch (error) {
            return next(error);
        }
    }
);

module.exports = router;