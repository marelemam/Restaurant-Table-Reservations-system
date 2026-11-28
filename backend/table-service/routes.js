const express = require("express");
const { requireAuth, requireRole } = require("../shared/auth");
const { query } = require("./db");

const router = express.Router();

const pool = { query };

router.get("/db-health", async (req, res) => {
    try {
        const result = await pool.query("SELECT 1");
        res.status(200).json({
            status: "ok",
            database: "connected"
        });
    } catch (error) {
        console.error("Database health check failed:", error.message);
        res.status(500).json({
            status: "error",
            database: "disconnected"
        });
    }
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// 1. Get all tables (any logged-in user)
router.get("/", requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM tables_cfg.restaurant_tables ORDER BY table_id"
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to retrieve tables" });
    }
});

// 2. Add a new table (staff only)
router.post("/", requireAuth, requireRole("staff", "admin"), async (req, res) => {
    try {
        const { table_number, capacity, location } = req.body || {};

        if (
            typeof table_number !== "string" ||
            table_number.trim() === "" ||
            table_number.length > 20 ||
            !Number.isInteger(capacity) ||
            capacity < 1 ||
            (
    location !== undefined &&
    location !== null &&
    (
        typeof location !== "string" ||
        location.trim().length > 100
    )
)
        ) {
            return res.status(400).json({
                error: "Valid table number and capacity are required"
            });
        }

        const result = await pool.query(
            `INSERT INTO tables_cfg.restaurant_tables
             (table_number, capacity, location, operational_status)
             VALUES ($1, $2, $3, 'available')
             RETURNING *`,
            [table_number.trim(), capacity, location || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "Table number already exists" });
        }
        console.error(error);
        res.status(500).json({ error: "Failed to add table" });
    }
});

// 3. Update table information (staff only)
router.put("/:id", requireAuth, requireRole("staff", "admin"), async (req, res) => {
    try {
        const { id } = req.params;
        const { table_number, capacity, location } = req.body || {};

        if (!UUID_RE.test(id)) {
            return res.status(400).json({ error: "Invalid id" });
        }

        if (
            typeof table_number !== "string" ||
            table_number.trim() === "" ||
            table_number.length > 20 ||
            !Number.isInteger(capacity) ||
            capacity < 1 ||
            (location && String(location).length > 100)
        ) {
            return res.status(400).json({
                error: "Valid table number and capacity are required"
            });
        }

        const result = await pool.query(
            `UPDATE tables_cfg.restaurant_tables
             SET table_number = $1,
                 capacity = $2,
                 location = $3
             WHERE table_id = $4
             RETURNING *`,
            [table_number.trim(), capacity, location || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Table not found" });
        }

        res.json(result.rows[0]);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "Table number already exists" });
        }
        console.error(error);
        res.status(500).json({ error: "Failed to update table" });
    }
});

// 4. Update table operational status (staff only)
router.patch("/:id/status", requireAuth, requireRole("staff", "admin"), async (req, res) => {
    try {
        const { id } = req.params;
        const { operational_status } = req.body || {};

        if (!UUID_RE.test(id)) {
            return res.status(400).json({ error: "Invalid id" });
        }

        const allowedStatuses = ["available", "maintenance"];

        if (!allowedStatuses.includes(operational_status)) {
            return res.status(400).json({
                error: "Invalid operational status"
            });
        }

        const result = await pool.query(
            `UPDATE tables_cfg.restaurant_tables
             SET operational_status = $1
             WHERE table_id = $2
             AND operational_status <> 'occupied'
             RETURNING *`,
            [operational_status, id]
        );

        if (result.rows.length === 0) {
            return res.status(409).json({
                error: "Table was not found or must be released through its seating session"
            });
        }

        console.log(JSON.stringify({
            type: "TABLE_STATUS_CHANGED",
            userId: req.user.id,
            tableId: id,
            newStatus: operational_status
        }));

        res.json(result.rows[0]);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Failed to update table status" });
    }
});

// 5. Find suitable tables based on party size (any logged-in user)
router.get("/suitable", requireAuth, async (req, res) => {
    try {
        const partySize = Number(req.query.party_size);

        if (!Number.isInteger(partySize) || partySize < 1) {
            return res.status(400).json({
                error: "A valid party_size is required"
            });
        }

        const result = await pool.query(
            `SELECT *
             FROM tables_cfg.restaurant_tables
             WHERE capacity >= $1
             AND operational_status = 'available'
             ORDER BY capacity ASC`,
            [partySize]
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to find suitable tables"
        });
    }
});

// 6. Get booking policies (any logged-in user)
router.get("/policies", requireAuth, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM tables_cfg.booking_policies ORDER BY policy_id"
        );

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to retrieve booking policies"
        });
    }
});

// 7. Get a single table by ID
router.get("/:id", requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        if (!UUID_RE.test(id)) {
            return res.status(400).json({
                error: "Invalid table ID"
            });
        }

        const result = await pool.query(
            `SELECT *
             FROM tables_cfg.restaurant_tables
             WHERE table_id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Table not found"
            });
        }

        res.status(200).json(result.rows[0]);

    } catch (error) {
        console.error("Get table error:", error);

        res.status(500).json({
            error: "Internal server error"
        });
    }
});


// 8. Update booking policy (staff only)
router.put("/policies/:id", requireAuth, requireRole("staff", "admin"), async (req, res) => {
    try {
        const { id } = req.params;
        const { max_duration, preparation_buffer } = req.body || {};

        if (!UUID_RE.test(id)) {
            return res.status(400).json({ error: "Invalid id" });
        }

        if (
            !Number.isInteger(max_duration) ||
            max_duration <= 0 ||
            !Number.isInteger(preparation_buffer) ||
            preparation_buffer < 0
        ) {
            return res.status(400).json({
                error: "Invalid booking policy values"
            });
        }

        const result = await pool.query(
            `UPDATE tables_cfg.booking_policies
             SET max_duration = $1,
                 preparation_buffer = $2
             WHERE policy_id = $3
             RETURNING *`,
            [max_duration, preparation_buffer, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                error: "Booking policy not found"
            });
        }

        res.json(result.rows[0]);
    } catch (error) {
        console.error(error);
        res.status(500).json({
            error: "Failed to update booking policy"
        });
    }
});

router.post("/:id/occupy", requireAuth, requireRole("staff", "admin"), async (req, res) => {
    const { id } = req.params;
    const { seatingId, sourceType, sourceId, partySize } = req.body || {};

    if (!UUID_RE.test(id) || !UUID_RE.test(seatingId)) {
        return res.status(400).json({ error: "Valid table and seating IDs are required" });
    }
    if (!["reservation", "waitlist"].includes(sourceType) || !sourceId) {
        return res.status(400).json({ error: "Valid sourceType and sourceId are required" });
    }
    if (!Number.isInteger(partySize) || partySize < 1) {
        return res.status(400).json({ error: "partySize must be a positive integer" });
    }

    try {
        const result = await pool.query(
            `UPDATE tables_cfg.restaurant_tables
             SET operational_status = 'occupied',
                 active_seating_id = $2,
                 occupancy_source_type = $3,
                 occupancy_source_id = $4
             WHERE table_id = $1
               AND operational_status = 'available'
               AND capacity >= $5
             RETURNING *`,
            [id, seatingId, sourceType, String(sourceId), partySize]
        );
        if (result.rowCount === 0) {
            return res.status(409).json({
                error: "Table is unavailable or too small for this party"
            });
        }
        return res.status(200).json({
            message: "Table occupied successfully",
            table: result.rows[0]
        });
    } catch (error) {
        console.error("Occupy table failed:", error.message);
        return res.status(500).json({ error: "Failed to occupy table" });
    }
});

router.post("/:id/release", requireAuth, requireRole("staff", "admin"), async (req, res) => {
    const { id } = req.params;
    const { seatingId } = req.body || {};

    if (!UUID_RE.test(id) || !UUID_RE.test(seatingId)) {
        return res.status(400).json({ error: "Valid table and seating IDs are required" });
    }

    try {
        const result = await pool.query(
            `UPDATE tables_cfg.restaurant_tables
             SET operational_status = 'available',
                 active_seating_id = NULL,
                 occupancy_source_type = NULL,
                 occupancy_source_id = NULL
             WHERE table_id = $1
               AND operational_status = 'occupied'
               AND active_seating_id = $2
             RETURNING *`,
            [id, seatingId]
        );
        if (result.rowCount === 0) {
            return res.status(409).json({
                error: "Table is not occupied by this seating session"
            });
        }
        return res.status(200).json({
            message: "Table released successfully",
            table: result.rows[0]
        });
    } catch (error) {
        console.error("Release table failed:", error.message);
        return res.status(500).json({ error: "Failed to release table" });
    }
});

module.exports = router;
