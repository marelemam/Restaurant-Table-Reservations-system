const express = require('express');
const pool = require('./db');
const { validateReservation } = require('./validation');
const { sendConfirmation, sendCancellation } = require('./notifications');
const { identify, requireAuth } = require('./auth');
const { validateTableForReservation } = require('./tableClient');
const router = express.Router();

// ---------- Health checks ----------
router.get('/health', (req, res) => {
  res.json({ service: 'reservation-service', status: 'ok' });
});

router.get('/db-check', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ db: 'ok', time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ db: 'error', message: err.message });
  }
});

// ---------- Customers (registering is open to everyone) ----------
router.post('/customers', requireAuth, async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'email must look like name@example.com' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO reservation.customer (cognito_sub, name, email, phone)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.sub, name, email, phone || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(err, res);
  }
});

// ---------- Reservations (you must say who you are) ----------
router.use('/reservations', identify);

// Customers are limited to their own id. Staff get null, meaning "no limit".
function ownerLimit(user) {
  return user.role === 'customer' ? user.customerId : null;
}

function requireStaffOrAdmin(req, res, next) {
  if (!['staff', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'staff or admin permission required' });
  }
  return next();
}

// Create: customers can only book for themselves, staff can book for anyone
router.post('/reservations', async (req, res) => {
  const body = { ...req.body };
  if (req.user.role === 'customer') {
    body.customerId = req.user.customerId;
  }

  const errors = validateReservation(body);
  if (errors.length) {
    return res.status(400).json({ errors });
  }
  const { customerId, tableId, reservationDate, startTime, endTime, partySize } = body;

  try {
    await validateTableForReservation(
      req, tableId, partySize, startTime, endTime
    );
    const clash = await pool.query(
      `SELECT 1 FROM reservation.reservation
       WHERE table_id = $1 AND reservation_date = $2 AND status = 'confirmed'
         AND start_time < $4 AND end_time > $3`,
      [tableId, reservationDate, startTime, endTime]
    );
    if (clash.rowCount > 0) {
      return res.status(409).json({ error: 'table is already booked at that time' });
    }

    const result = await pool.query(
      `INSERT INTO reservation.reservation
         (customer_id, table_id, reservation_date, start_time, end_time, party_size)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customerId, tableId, reservationDate, startTime, endTime, partySize]
    );
    const emailSent = await notify(result.rows[0], 'confirmed');
    res.status(201).json({ ...result.rows[0], emailSent });
  } catch (err) {
    handleDbError(err, res);
  }
});

// List: customers see only theirs, staff see all (or filter with ?customerId=)
router.get('/reservations', async (req, res) => {
  const filterId = req.user.role === 'customer'
    ? req.user.customerId
    : (req.query.customerId || null);
  try {
    const result = filterId
      ? await pool.query(
          'SELECT * FROM reservation.reservation WHERE customer_id = $1 ORDER BY reservation_date, start_time',
          [filterId]
        )
      : await pool.query(
          'SELECT * FROM reservation.reservation ORDER BY reservation_date, start_time'
        );
    res.json(result.rows);
  } catch (err) {
    handleDbError(err, res);
  }
});

// View one
router.get('/reservations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM reservation.reservation
       WHERE reservation_id = $1 AND ($2::int IS NULL OR customer_id = $2)`,
      [req.params.id, ownerLimit(req.user)]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'reservation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(err, res);
  }
});

// Cancel
router.patch('/reservations/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE reservation.reservation SET status = 'cancelled'
       WHERE reservation_id = $1 AND status = 'confirmed'
         AND ($2::int IS NULL OR customer_id = $2)
       RETURNING *`,
      [req.params.id, ownerLimit(req.user)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'no confirmed reservation with that id' });
    }
    const emailSent = await notify(result.rows[0], 'cancelled');
    res.json({ ...result.rows[0], emailSent });
  } catch (err) {
    handleDbError(err, res);
  }
});

router.patch('/reservations/:id/status', requireStaffOrAdmin, async (req, res) => {
  const { status } = req.body || {};
  const transitions = {
    confirmed: ['checked_in', 'no_show', 'cancelled'],
    checked_in: ['seated', 'cancelled'],
    seated: ['completed'],
    no_show: [],
    completed: [],
    cancelled: []
  };

  if (!Object.prototype.hasOwnProperty.call(transitions, status)) {
    return res.status(400).json({ error: 'invalid reservation status' });
  }

  try {
    const current = await pool.query(
      'SELECT * FROM reservation.reservation WHERE reservation_id = $1',
      [req.params.id]
    );
    if (current.rowCount === 0) {
      return res.status(404).json({ error: 'reservation not found' });
    }
    const oldStatus = current.rows[0].status;
    if (!transitions[oldStatus]?.includes(status)) {
      return res.status(409).json({
        error: `cannot change reservation from ${oldStatus} to ${status}`
      });
    }
    const result = await pool.query(
      `UPDATE reservation.reservation SET status = $1
       WHERE reservation_id = $2 RETURNING *`,
      [status, req.params.id]
    );
    return res.json({
      message: 'Reservation status updated',
      reservation: result.rows[0]
    });
  } catch (err) {
    return handleDbError(err, res);
  }
});

// Modify
router.patch('/reservations/:id', async (req, res) => {
  const { tableId, reservationDate, startTime, endTime, partySize } = req.body;
  try {
    const current = await pool.query(
      `SELECT * FROM reservation.reservation
       WHERE reservation_id = $1 AND ($2::int IS NULL OR customer_id = $2)`,
      [req.params.id, ownerLimit(req.user)]
    );
    if (current.rowCount === 0) {
      return res.status(404).json({ error: 'reservation not found' });
    }
    const old = current.rows[0];
    if (old.status !== 'confirmed') {
      return res.status(400).json({ error: 'only confirmed reservations can be changed' });
    }

    const newTable = tableId ?? old.table_id;
    const newDate  = reservationDate ?? old.reservation_date;
    const newStart = startTime ?? old.start_time;
    const newEnd   = endTime ?? old.end_time;
    const newSize  = partySize ?? old.party_size;

    const errors = validateReservation({
      customerId: old.customer_id,
      tableId: newTable,
      reservationDate: newDate,
      startTime: newStart,
      endTime: newEnd,
      partySize: newSize,
    });
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    await validateTableForReservation(
      req, newTable, newSize, newStart, newEnd
    );

    const clash = await pool.query(
      `SELECT 1 FROM reservation.reservation
       WHERE table_id = $1 AND reservation_date = $2 AND status = 'confirmed'
         AND start_time < $4 AND end_time > $3
         AND reservation_id <> $5`,
      [newTable, newDate, newStart, newEnd, req.params.id]
    );
    if (clash.rowCount > 0) {
      return res.status(409).json({ error: 'table is already booked at that time' });
    }

    const result = await pool.query(
      `UPDATE reservation.reservation
       SET table_id = $1, reservation_date = $2, start_time = $3, end_time = $4, party_size = $5
       WHERE reservation_id = $6 RETURNING *`,
      [newTable, newDate, newStart, newEnd, newSize, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(err, res);
  }
});

// Look up the customer and send the right email. Never breaks the request.
async function notify(reservation, type) {
  try {
    const c = await pool.query(
      'SELECT name, email FROM reservation.customer WHERE customer_id = $1',
      [reservation.customer_id]
    );
    if (c.rowCount === 0) return false;
    return type === 'confirmed'
      ? await sendConfirmation(c.rows[0], reservation)
      : await sendCancellation(c.rows[0], reservation);
  } catch (err) {
    console.error('Notify failed:', err.message);
    return false;
  }
}

// ---------- Turn database errors into clear replies ----------
function handleDbError(err, res) {
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  if (err.code === '23P01') return res.status(409).json({ error: 'table is already booked at that time' });
  if (err.code === '23505') return res.status(409).json({ error: 'email already registered' });
  if (err.code === '23503') return res.status(400).json({ error: 'customer does not exist' });
  if (err.code === '23514') return res.status(400).json({ error: 'invalid values (check party size and times)' });
  if (err.code && err.code.startsWith('22')) return res.status(400).json({ error: 'wrong data format' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
}

module.exports = router;
