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

const activityQueryValidators = [
    validateQuery("staffId")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("staffId cannot be empty")
        .isLength({ max: 200 })
        .withMessage("staffId must not exceed 200 characters"),

    validateQuery("action")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("action cannot be empty")
        .isLength({ max: 100 })
        .withMessage("action must not exceed 100 characters"),

    validateQuery("entityType")
        .optional()
        .trim()
        .notEmpty()
        .withMessage("entityType cannot be empty")
        .isLength({ max: 100 })
        .withMessage("entityType must not exceed 100 characters"),

    validateQuery("limit")
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage("limit must be between 1 and 100"),

    validateQuery("offset")
        .optional()
        .isInt({ min: 0 })
        .withMessage("offset must be zero or greater")
];

router.get(
    "/",
    activityQueryValidators,
    async (req, res, next) => {
        const errors = validationResult(req);

        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: "Validation failed",
                details: errors.array()
            });
        }

        const authenticatedStaffId = req.user.sub;
        const groups = req.user.groups || [];
        const isAdmin = groups.includes("Admin");

        const requestedStaffId = req.query.staffId;
        const action = req.query.action;
        const entityType = req.query.entityType;

        const limit = Number(req.query.limit || 50);
        const offset = Number(req.query.offset || 0);

        if (
            !isAdmin &&
            requestedStaffId &&
            requestedStaffId !== authenticatedStaffId
        ) {
            return res.status(403).json({
                error: "Staff members can only view their own activity"
            });
        }

        const conditions = [];
        const values = [];

        if (isAdmin && requestedStaffId) {
            values.push(requestedStaffId);
            conditions.push(`staff_id = $${values.length}`);
        }

        if (!isAdmin) {
            values.push(authenticatedStaffId);
            conditions.push(`staff_id = $${values.length}`);
        }

        if (action) {
            values.push(action);
            conditions.push(`action = $${values.length}`);
        }

        if (entityType) {
            values.push(entityType);
            conditions.push(`entity_type = $${values.length}`);
        }

        const whereClause =
            conditions.length > 0
                ? `WHERE ${conditions.join(" AND ")}`
                : "";

        try {
            const countResult = await databaseQuery(
                `SELECT COUNT(*)::INTEGER AS total
                 FROM staff_operations.staff_activity_logs
                 ${whereClause}`,
                values
            );

            const dataValues = [...values];

            dataValues.push(limit);
            const limitPosition = dataValues.length;

            dataValues.push(offset);
            const offsetPosition = dataValues.length;

            const activityResult = await databaseQuery(
                `SELECT
                    activity_id,
                    staff_id,
                    action,
                    entity_type,
                    entity_id,
                    request_id,
                    timestamp,
                    details
                 FROM staff_operations.staff_activity_logs
                 ${whereClause}
                 ORDER BY timestamp DESC
                 LIMIT $${limitPosition}
                 OFFSET $${offsetPosition}`,
                dataValues
            );

            return res.status(200).json({
                count: activityResult.rowCount,
                total: Number(countResult.rows[0].total),
                limit,
                offset,
                activityLogs: activityResult.rows
            });
        } catch (error) {
            return next(error);
        }
    }
);

module.exports = router;