const express = require("express");
const { body, param, validationResult } = require("express-validator");
const { randomUUID } = require("crypto");
const { getPool, query } = require("../db");
const { requireStaffOrAdmin } = require("../middleware/auth");

const router = express.Router();


router.use(requireStaffOrAdmin);

const createSeatingValidators = [
    body("tableId")
        .trim()
        .notEmpty()
        .withMessage("tableId is required")
        .isLength({ max: 100 })
        .withMessage("tableId must not exceed 100 characters"),

    body("reservationId")
        .optional({ nullable: true })
        .isString()
        .withMessage("reservationId must be a string")
        .trim()
        .notEmpty()
        .withMessage("reservationId cannot be empty"),

    body("waitlistId")
        .optional({ nullable: true })
        .isUUID()
        .withMessage("waitlistId must be a valid UUID")
];

router.post("/", createSeatingValidators, async (req, res, next) => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: "Validation failed",
            details: errors.array()
        });
    }

    const { tableId, reservationId, waitlistId } = req.body;

    const hasReservation = Boolean(reservationId);
    const hasWaitlistEntry = Boolean(waitlistId);

    if (hasReservation === hasWaitlistEntry) {
        return res.status(400).json({
            error: "Provide exactly one of reservationId or waitlistId"
        });
    }

    const staffId =
        req.user?.sub ||
        req.auth?.sub ||
        req.user?.id ||
        req.auth?.id;

    if (!staffId) {
        return res.status(401).json({
            error: "Authenticated staff identity is required"
        });
    }

    const pool = getPool();
    const client = await pool.connect();
    const requestId = randomUUID();

    try {
        await client.query("BEGIN");

        // Prevent two simultaneous requests from seating customers
        // at the same table.
        await client.query(
            "SELECT pg_advisory_xact_lock(hashtext($1))",
            [tableId]
        );

        if (waitlistId) {
            const waitlistResult = await client.query(
                `SELECT waitlist_id, status
                 FROM staff_operations.waitlist_entries
                 WHERE waitlist_id = $1
                 FOR UPDATE`,
                [waitlistId]
            );

            if (waitlistResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Waitlist entry not found"
                });
            }

            const waitlistStatus = waitlistResult.rows[0].status;

            if (!["waiting", "notified"].includes(waitlistStatus)) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Waitlist entry cannot be seated",
                    currentStatus: waitlistStatus
                });
            }
        }

        const seatingResult = await client.query(
            `INSERT INTO staff_operations.seating_sessions
                (
                    reservation_id,
                    waitlist_id,
                    table_id,
                    status,
                    recorded_by
                )
             VALUES ($1, $2, $3, 'seated', $4)
             RETURNING *`,
            [
                reservationId || null,
                waitlistId || null,
                tableId,
                staffId
            ]
        );

        const seating = seatingResult.rows[0];

        if (waitlistId) {
            await client.query(
                `UPDATE staff_operations.waitlist_entries
                 SET status = 'seated',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE waitlist_id = $1`,
                [waitlistId]
            );
        }

        await client.query(
            `INSERT INTO staff_operations.staff_activity_logs
                (
                    staff_id,
                    action,
                    entity_type,
                    entity_id,
                    request_id,
                    details
                )
             VALUES ($1, 'CUSTOMER_SEATED', 'seating', $2, $3, $4::JSONB)`,
            [
                staffId,
                seating.seating_id,
                requestId,
                JSON.stringify({
                    tableId,
                    reservationId: reservationId || null,
                    waitlistId: waitlistId || null
                })
            ]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            message: "Customer seated successfully",
            seating
        });
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(409).json({
                error:
                    "The table, reservation or waitlist entry already has an active seating session"
            });
        }

        return next(error);
    } finally {
        client.release();
    }
});

router.get("/", async (req, res, next) => {
    try {
        const result = await query(
            `SELECT
                seating.seating_id,
                seating.reservation_id,
                seating.waitlist_id,
                seating.table_id,
                seating.seated_at,
                seating.status,
                seating.recorded_by,
                waitlist.customer_name,
                waitlist.phone,
                waitlist.party_size
             FROM staff_operations.seating_sessions AS seating
             LEFT JOIN staff_operations.waitlist_entries AS waitlist
                ON waitlist.waitlist_id = seating.waitlist_id
             WHERE seating.status = 'seated'
             ORDER BY seating.seated_at ASC`
        );

        return res.status(200).json({
            count: result.rowCount,
            seating: result.rows
        });
    } catch (error) {
        return next(error);
    }
});

router.patch(
    "/:id/transfer",
    [
        param("id")
            .isUUID()
            .withMessage("A valid seating ID is required"),

        body("newTableId")
            .trim()
            .notEmpty()
            .withMessage("newTableId is required")
            .isLength({ max: 100 })
            .withMessage("newTableId must not exceed 100 characters")
    ],
    async (req, res, next) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: "Validation failed",
                details: errors.array()
            });
        }

        const seatingId = req.params.id;
        const { newTableId } = req.body;

        const staffId =
            req.user?.sub ||
            req.auth?.sub ||
            req.user?.id ||
            req.auth?.id;

        if (!staffId) {
            return res.status(401).json({
                error: "Authenticated staff identity is required"
            });
        }

        const client = await getPool().connect();
        const requestId = randomUUID();

        try {
            await client.query("BEGIN");

            await client.query(
                "SELECT pg_advisory_xact_lock(hashtext($1))",
                [newTableId]
            );

            const currentResult = await client.query(
                `SELECT seating_id, table_id, status
                 FROM staff_operations.seating_sessions
                 WHERE seating_id = $1
                 FOR UPDATE`,
                [seatingId]
            );

            if (currentResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Seating session not found"
                });
            }

            const currentSeating = currentResult.rows[0];

            if (currentSeating.status !== "seated") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Only an active seating session can be transferred",
                    currentStatus: currentSeating.status
                });
            }

            if (currentSeating.table_id === newTableId) {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "Customer is already seated at this table"
                });
            }

            const updateResult = await client.query(
                `UPDATE staff_operations.seating_sessions
                 SET table_id = $2
                 WHERE seating_id = $1
                 RETURNING *`,
                [seatingId, newTableId]
            );

            await client.query(
                `INSERT INTO staff_operations.staff_activity_logs
                    (
                        staff_id,
                        action,
                        entity_type,
                        entity_id,
                        request_id,
                        details
                    )
                 VALUES ($1, 'TABLE_TRANSFERRED', 'seating', $2, $3, $4::JSONB)`,
                [
                    staffId,
                    seatingId,
                    requestId,
                    JSON.stringify({
                        previousTableId: currentSeating.table_id,
                        newTableId
                    })
                ]
            );

            await client.query("COMMIT");

            return res.status(200).json({
                message: "Customer transferred successfully",
                seating: updateResult.rows[0]
            });
        } catch (error) {
            await client.query("ROLLBACK");

            if (error.code === "23505") {
                return res.status(409).json({
                    error: "The destination table is already occupied"
                });
            }

            return next(error);
        } finally {
            client.release();
        }
    }
);

router.patch(
    "/:id/checkout",
    [
        param("id")
            .isUUID()
            .withMessage("A valid seating ID is required")
    ],
    async (req, res, next) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: "Validation failed",
                details: errors.array()
            });
        }

        const seatingId = req.params.id;

        const staffId =
            req.user?.sub ||
            req.auth?.sub ||
            req.user?.id ||
            req.auth?.id;

        if (!staffId) {
            return res.status(401).json({
                error: "Authenticated staff identity is required"
            });
        }

        const client = await getPool().connect();
        const requestId = randomUUID();

        try {
            await client.query("BEGIN");

            const currentResult = await client.query(
                `SELECT seating_id, table_id, status
                 FROM staff_operations.seating_sessions
                 WHERE seating_id = $1
                 FOR UPDATE`,
                [seatingId]
            );

            if (currentResult.rowCount === 0) {
                await client.query("ROLLBACK");

                return res.status(404).json({
                    error: "Seating session not found"
                });
            }

            const currentSeating = currentResult.rows[0];

            if (currentSeating.status !== "seated") {
                await client.query("ROLLBACK");

                return res.status(409).json({
                    error: "This seating session is not active",
                    currentStatus: currentSeating.status
                });
            }

            const updateResult = await client.query(
                `UPDATE staff_operations.seating_sessions
                 SET status = 'checked_out',
                     checkout_at = CURRENT_TIMESTAMP
                 WHERE seating_id = $1
                 RETURNING *`,
                [seatingId]
            );

            await client.query(
                `INSERT INTO staff_operations.staff_activity_logs
                    (
                        staff_id,
                        action,
                        entity_type,
                        entity_id,
                        request_id,
                        details
                    )
                 VALUES ($1, 'CUSTOMER_CHECKED_OUT', 'seating', $2, $3, $4::JSONB)`,
                [
                    staffId,
                    seatingId,
                    requestId,
                    JSON.stringify({
                        tableId: currentSeating.table_id
                    })
                ]
            );

            await client.query("COMMIT");

            return res.status(200).json({
                message: "Customer checked out successfully",
                seating: updateResult.rows[0]
            });
        } catch (error) {
            await client.query("ROLLBACK");
            return next(error);
        } finally {
            client.release();
        }
    }
);
module.exports = router;