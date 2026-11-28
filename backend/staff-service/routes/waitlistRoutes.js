const express = require("express");
const {
    body,
    param,
    validationResult
} = require("express-validator");


const {
    publishStaffEvent
} = require("../services/eventPublisher");
const { randomUUID } = require("crypto");

const { getPool, query } = require("../db");
const { requireStaffOrAdmin } = require("../middleware/auth");

const {
    publishNotification
} = require("../services/notificationPublisher");



const router = express.Router();

router.post(
    "/",
    requireStaffOrAdmin,
    [
        body("customerName")
            .trim()
            .isLength({ min: 2, max: 120 })
            .withMessage("Customer name must contain 2 to 120 characters"),

        body("phone")
            .trim()
            .matches(/^[0-9+\-\s()]{7,30}$/)
            .withMessage("Enter a valid phone number"),

        body("partySize")
            .isInt({ min: 1, max: 20 })
            .withMessage("Party size must be between 1 and 20")
            .toInt()
    ],
    async (req, res, next) => {
        const validationErrors = validationResult(req);

        if (!validationErrors.isEmpty()) {
            return res.status(400).json({
                error: "Validation failed",
                details: validationErrors.array()
            });
        }

        const {
            customerName,
            phone,
            partySize
        } = req.body;

        const staffId = req.user.sub;
        const requestId = req.get("x-request-id") || randomUUID();

        const client = await getPool().connect();

        try {
            await client.query("BEGIN");

            // Serializes queue insertion so two simultaneous requests
            // cannot receive the same calculated queue position.
            await client.query(
                "SELECT pg_advisory_xact_lock($1)",
                [90210]
            );

            const countResult = await client.query(`
                SELECT COUNT(*)::INTEGER AS waiting_count
                FROM staff_operations.waitlist_entries
                WHERE status IN ('waiting', 'notified')
            `);

            const waitingCount =
                countResult.rows[0].waiting_count;

            const estimatedWaitMinutes =
                Math.min(240, 10 + waitingCount * 10);

            const insertResult = await client.query(
                `
                INSERT INTO staff_operations.waitlist_entries (
                    customer_name,
                    phone,
                    party_size,
                    estimated_wait_minutes,
                    status,
                    created_by
                )
                VALUES ($1, $2, $3, $4, 'waiting', $5)
                RETURNING *
                `,
                [
                    customerName,
                    phone,
                    partySize,
                    estimatedWaitMinutes,
                    staffId
                ]
            );

            const createdEntry = insertResult.rows[0];

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
                    'WAITLIST_ENTRY_CREATED',
                    'waitlist',
                    $2,
                    $3,
                    $4::JSONB
                )
                `,
                [
                    staffId,
                    createdEntry.waitlist_id,
                    requestId,
                    JSON.stringify({
                        partySize,
                        estimatedWaitMinutes
                    })
                ]
            );

            await client.query("COMMIT");
            await publishStaffEvent(
    "WAITLIST_ENTRY_CREATED",
    {
        waitlistId: createdEntry.waitlist_id,
        customerName: createdEntry.customer_name,
        partySize: createdEntry.party_size,
        estimatedWaitMinutes:
            createdEntry.estimated_wait_minutes,
        status: createdEntry.status,
        recordedBy: req.user?.sub || "unknown"
    }
);

            
            

            return res.status(201).json({
                message: "Walk-in added to the waitlist",
                waitlistEntry: createdEntry
            });
        } catch (error) {
            await client.query("ROLLBACK");
            next(error);
        } finally {
            client.release();
        }
    }
);

router.get(
    "/",
    requireStaffOrAdmin,
    async (req, res, next) => {
        try {
            const result = await query(`
                SELECT
                    waitlist_id,
                    customer_name,
                    phone,
                    party_size,
                    estimated_wait_minutes,
                    status,
                    notified_at,
                    created_by,
                    created_at,
                    updated_at,
                    ROW_NUMBER() OVER (
                        ORDER BY created_at, waitlist_id
                    ) AS queue_position
                FROM staff_operations.waitlist_entries
                WHERE status IN ('waiting', 'notified')
                ORDER BY created_at, waitlist_id
            `);

            return res.status(200).json({
                count: result.rowCount,
                waitlist: result.rows
            });
        } catch (error) {
            next(error);
        }
    }
);

router.patch(
    "/:id/notify",
    requireStaffOrAdmin,
    [
        param("id")
            .isUUID()
            .withMessage("A valid waitlist ID is required")
    ],
    async (req, res, next) => {
        await updateWaitlistStatus(req, res, next, {
            newStatus: "notified",
            allowedCurrentStatuses: ["waiting"],
            activityAction: "WAITLIST_CUSTOMER_NOTIFIED",
            responseMessage: "Waitlist customer marked as notified"
        });
    }
);

router.patch(
    "/:id/cancel",
    requireStaffOrAdmin,
    [
        param("id")
            .isUUID()
            .withMessage("A valid waitlist ID is required")
    ],
    async (req, res, next) => {
        await updateWaitlistStatus(req, res, next, {
            newStatus: "cancelled",
            allowedCurrentStatuses: [
                "waiting",
                "notified"
            ],
            activityAction: "WAITLIST_ENTRY_CANCELLED",
            responseMessage: "Waitlist entry cancelled"
        });
    }
);


async function updateWaitlistStatus(
    req,
    res,
    next,
    {
        newStatus,
        allowedCurrentStatuses,
        activityAction,
        responseMessage
    }
) {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: "Validation failed",
            details: errors.array()
        });
    }

    const waitlistId = req.params.id;
    const staffId = req.user.sub;
    const requestId = req.get("x-request-id") || randomUUID();

    const client = await getPool().connect();

    try {
        await client.query("BEGIN");

       const shouldSetNotifiedTime = newStatus === "notified";

     const updateResult = await client.query(
    `UPDATE staff_operations.waitlist_entries
     SET status = $2,
         notified_at = CASE
             WHEN $4::BOOLEAN THEN CURRENT_TIMESTAMP
             ELSE notified_at
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE waitlist_id = $1
       AND status = ANY($3::VARCHAR[])
     RETURNING *`,
    [
        waitlistId,
        newStatus,
        allowedCurrentStatuses,
        shouldSetNotifiedTime
    ]
);

        if (updateResult.rowCount === 0) {
            const existingResult = await client.query(
                `
                SELECT status
                FROM staff_operations.waitlist_entries
                WHERE waitlist_id = $1
                `,
                [waitlistId]
            );

            await client.query("ROLLBACK");

            if (existingResult.rowCount === 0) {
                return res.status(404).json({
                    error: "Waitlist entry not found"
                });
            }

            return res.status(409).json({
                error:
                    `Cannot change a ${existingResult.rows[0].status} entry to ${newStatus}`
            });
        }

        const updatedEntry = updateResult.rows[0];

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
                'waitlist',
                $3,
                $4,
                $5::JSONB
            )
            `,
            [
                staffId,
                activityAction,
                waitlistId,
                requestId,
                JSON.stringify({
                    newStatus
                })
            ]
        );

        await client.query("COMMIT");

if (newStatus === "notified") {
    await publishNotification(
        "WAITLIST_CUSTOMER_NOTIFIED",
        {
            waitlistId: updatedEntry.waitlist_id,
            customerName: updatedEntry.customer_name,
            phone: updatedEntry.phone,
            partySize: updatedEntry.party_size,
            estimatedWaitMinutes:
                updatedEntry.estimated_wait_minutes,
            message:
                `Your table is expected to be ready in approximately ${updatedEntry.estimated_wait_minutes} minutes.`,
            notifiedBy: staffId
        }
    );
}

return res.status(200).json({
    message: responseMessage,
    waitlistEntry: updatedEntry
});
    } catch (error) {
        await client.query("ROLLBACK");
        next(error);
    } finally {
        client.release();
    }
}

module.exports = router;