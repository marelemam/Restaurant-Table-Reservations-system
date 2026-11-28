
const express = require('express');
const pool = require('./db');
const { validateReservation } = require('./validation');
const { sendConfirmation, sendCancellation } = require('./notifications');
const { identify } = require('./auth');

const router = express.Router();

// ---------- Health checks ----------

router.get('/health', (req, res) => {
  res.json({
    service: 'reservation-service',
    status: 'ok'
  });
});

router.get('/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');

    res.json({
      db: 'ok',
      time: result.rows[0].now
    });
  } catch (err) {
    res.status(500).json({
      db: 'error',
      message: err.message
    });
  }
});

// ---------- Customers ----------
// Registering is open to everyone.

router.post('/customers', async (req, res) => {
  const { name, email, phone } = req.body;

  if (!name || !email) {
    return res.status(400).json({
      error: 'name and email are required'
    });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({
      error: 'email must look like name@example.com'
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO reservation.customer
       (name, email, phone)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, email, phone || null]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    return handleDbError(err, res);
  }
});

// ---------- Reservations ----------
// All reservation routes require authentication.

router.use('/reservations', identify);

// Customers can access only their own reservations.
// Staff can access all reservations.

function ownerLimit(user) {
  return user.role === 'customer' ? user.customerId : null;
}

// ---------- Create reservation ----------

router.post('/reservations', async (req, res) => {
  const body = { ...req.body };

  // Customers can only create reservations for themselves.
  if (req.user.role === 'customer') {
    body.customerId = req.user.customerId;
  }

  const errors = validateReservation(body);

  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const {
    customerId,
    tableId,
    reservationDate,
    startTime,
    endTime,
    partySize
  } = body;

  try {
    // 1. Check whether the table exists.
    const tableCheck = await pool.query(
      `SELECT capacity, operational_status
       FROM tables_cfg.restaurant_tables
       WHERE table_id = $1`,
      [tableId]
    );

    if (tableCheck.rowCount === 0) {
      return res.status(404).json({
        error: 'table not found'
      });
    }

    const table = tableCheck.rows[0];

    // 2. Check whether the table is available for booking.
    if (table.operational_status !== 'available') {
      return res.status(400).json({
        error: 'table is not available for booking'
      });
    }

    // 3. Check whether the table capacity is enough.
    if (partySize > table.capacity) {
      return res.status(400).json({
        error: 'party size exceeds table capacity'
      });
    }

    // 4. Check for reservation time conflicts.
    const clash = await pool.query(
      `SELECT 1
       FROM reservation.reservation
       WHERE table_id = $1
         AND reservation_date = $2
         AND status = 'confirmed'
         AND start_time < $4
         AND end_time > $3`,
      [tableId, reservationDate, startTime, endTime]
    );

    if (clash.rowCount > 0) {
      return res.status(409).json({
        error: 'table is already booked at that time'
      });
    }

    // 5. Create the reservation.
    const result = await pool.query(
      `INSERT INTO reservation.reservation
       (customer_id, table_id, reservation_date,
        start_time, end_time, party_size)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        customerId,
        tableId,
        reservationDate,
        startTime,
        endTime,
        partySize
      ]
    );

    // 6. Send confirmation email.
    const emailSent = await notify(result.rows[0], 'confirmed');

    return res.status(201).json({
      ...result.rows[0],
      emailSent
    });

  } catch (err) {
    return handleDbError(err, res);
  }
});

// ---------- List reservations ----------
// Customers see only their own reservations.
// Staff can see all reservations or filter by customerId.

router.get('/reservations', async (req, res) => {
  const filterId = req.user.role === 'customer'
    ? req.user.customerId
    : (req.query.customerId || null);

  try {
    const result = filterId
      ? await pool.query(
          `SELECT *
           FROM reservation.reservation
           WHERE customer_id = $1
           ORDER BY reservation_date, start_time`,
          [filterId]
        )
      : await pool.query(
          `SELECT *
           FROM reservation.reservation
           ORDER BY reservation_date, start_time`
        );

    return res.json(result.rows);

  } catch (err) {
    return handleDbError(err, res);
  }
});

// ---------- View one reservation ----------

router.get('/reservations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT *
       FROM reservation.reservation
       WHERE reservation_id = $1
         AND ($2::int IS NULL OR customer_id = $2)`,
      [req.params.id, ownerLimit(req.user)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'reservation not found'
      });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    return handleDbError(err, res);
  }
});

// ---------- Cancel reservation ----------

router.patch('/reservations/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE reservation.reservation
       SET status = 'cancelled'
       WHERE reservation_id = $1
         AND status = 'confirmed'
         AND ($2::int IS NULL OR customer_id = $2)
       RETURNING *`,
      [req.params.id, ownerLimit(req.user)]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'no confirmed reservation with that id'
      });
    }

    const emailSent = await notify(result.rows[0], 'cancelled');

    return res.json({
      ...result.rows[0],
      emailSent
    });

  } catch (err) {
    return handleDbError(err, res);
  }
});

// ---------- Modify reservation ----------

router.patch('/reservations/:id', async (req, res) => {
  const {
    tableId,
    reservationDate,
    startTime,
    endTime,
    partySize
  } = req.body;

  try {
    // 1. Find the existing reservation.
    const current = await pool.query(
      `SELECT *
       FROM reservation.reservation
       WHERE reservation_id = $1
         AND ($2::int IS NULL OR customer_id = $2)`,
      [req.params.id, ownerLimit(req.user)]
    );

    if (current.rowCount === 0) {
      return res.status(404).json({
        error: 'reservation not found'
      });
    }

    const old = current.rows[0];

    if (old.status !== 'confirmed') {
      return res.status(400).json({
        error: 'only confirmed reservations can be changed'
      });
    }

    // 2. Use new values if provided, otherwise keep old values.
    const newTable = tableId ?? old.table_id;
    const newDate = reservationDate ?? old.reservation_date;
    const newStart = startTime ?? old.start_time;
    const newEnd = endTime ?? old.end_time;
    const newSize = partySize ?? old.party_size;

    // 3. Validate the updated reservation data.
    const errors = validateReservation({
      customerId: old.customer_id,
      tableId: newTable,
      reservationDate: newDate,
      startTime: newStart,
      endTime: newEnd,
      partySize: newSize
    });

    if (errors.length) {
      return res.status(400).json({ errors });
    }

    // 4. Check whether the new table exists.
    const tableCheck = await pool.query(
      `SELECT capacity, operational_status
       FROM tables_cfg.restaurant_tables
       WHERE table_id = $1`,
      [newTable]
    );

    if (tableCheck.rowCount === 0) {
      return res.status(404).json({
        error: 'table not found'
      });
    }

    const table = tableCheck.rows[0];

    // 5. Check whether the table is available for booking.
    if (table.operational_status !== 'available') {
      return res.status(400).json({
        error: 'table is not available for booking'
      });
    }

    // 6. Check whether the table capacity is enough.
    if (newSize > table.capacity) {
      return res.status(400).json({
        error: 'party size exceeds table capacity'
      });
    }

    // 7. Check for conflicts, excluding the current reservation.
    const clash = await pool.query(
      `SELECT 1
       FROM reservation.reservation
       WHERE table_id = $1
         AND reservation_date = $2
         AND status = 'confirmed'
         AND start_time < $4
         AND end_time > $3
         AND reservation_id <> $5`,
      [newTable, newDate, newStart, newEnd, req.params.id]
    );

    if (clash.rowCount > 0) {
      return res.status(409).json({
        error: 'table is already booked at that time'
      });
    }

    // 8. Update the reservation.
    const result = await pool.query(
      `UPDATE reservation.reservation
       SET table_id = $1,
           reservation_date = $2,
           start_time = $3,
           end_time = $4,
           party_size = $5
       WHERE reservation_id = $6
         AND ($7::int IS NULL OR customer_id = $7)
       RETURNING *`,
      [
        newTable,
        newDate,
        newStart,
        newEnd,
        newSize,
        req.params.id,
        ownerLimit(req.user)
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'reservation not found'
      });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    return handleDbError(err, res);
  }
});

// ---------- Send notification email ----------
// Email failure does not cancel or undo the reservation.

async function notify(reservation, type) {
  try {
    const c = await pool.query(
      `SELECT name, email
       FROM reservation.customer
       WHERE customer_id = $1`,
      [reservation.customer_id]
    );

    if (c.rowCount === 0) {
      return false;
    }

    return type === 'confirmed'
      ? await sendConfirmation(c.rows[0], reservation)
      : await sendCancellation(c.rows[0], reservation);

  } catch (err) {
    console.error('Notify failed:', err.message);
    return false;
  }
}

// ---------- Database error handling ----------

function handleDbError(err, res) {
  if (err.code === '23P01') {
    return res.status(409).json({
      error: 'table is already booked at that time'
    });
  }

  if (err.code === '23505') {
    return res.status(409).json({
      error: 'email already registered'
    });
  }

  if (err.code === '23503') {
    return res.status(400).json({
      error: 'customer does not exist'
    });
  }

  if (err.code === '23514') {
    return res.status(400).json({
      error: 'invalid values (check party size and times)'
    });
  }

  if (err.code && err.code.startsWith('22')) {
    return res.status(400).json({
      error: 'wrong data format'
    });
  }

  console.error(err);

  return res.status(500).json({
    error: 'server error'
  });
}

module.exports = router;
