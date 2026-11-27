const express = require("express");
const { Pool } = require("pg");
const { requireAuth, requireRole } = require("../shared/auth");

const router = express.Router();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
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
router.post("/", requireAuth, requireRole("staff"), async (req, res) => {
    try {
        const { table_number, capacity, location } = req.body;

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
router.put("/:id", requireAuth, requireRole("staff"), async (req, res) => {
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
router.patch("/:id/status", requireAuth, requireRole("staff"), async (req, res) => {
    try {
        const { id } = req.params;
        const { operational_status } = req.body || {};

        if (!UUID_RE.test(id)) {
            return res.status(400).json({ error: "Invalid id" });
        }

        const allowedStatuses = ["available", "occupied", "maintenance"];

        if (!allowedStatuses.includes(operational_status)) {
            return res.status(400).json({
                error: "Invalid operational status"
            });
        }

        const result = await pool.query(
            `UPDATE tables_cfg.restaurant_tables
             SET operational_status = $1
             WHERE table_id = $2
             RETURNING *`,
            [operational_status, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Table not found" });
        }

                if (result.rows.length === 0) {
            return res.status(404).json({ error: "Table not found" });
        }

        console.log(JSON.stringify({           // ← السطر الجديد
            type: "TABLE_STATUS_CHANGED",
            userId: req.user.id,
            tableId: id,
            newStatus: operational_status
        }));

        res.json(result.rows[0]);

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

// 7. Update booking policy (staff only)
router.put("/policies/:id", requireAuth, requireRole("staff"), async (req, res) => {
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

module.exports = router;