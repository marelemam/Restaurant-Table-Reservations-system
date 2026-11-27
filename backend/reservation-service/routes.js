const express = require('express');
const pool = require('./db');
const { validateReservation } = require('./validation');
const { sendConfirmation, sendCancellation } = require('./notifications');
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

// ---------- Customers ----------
router.post('/customers', async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) {
    return res.status(400).json({ error: 'name and email are required' });
  }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'email must look like name@example.com' });
  }
  try {
    const result = await pool.query(
      'INSERT INTO reservation.customer (name, email, phone) VALUES ($1, $2, $3) RETURNING *',
      [name, email, phone || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleDbError(err, res);
  }
});

// ---------- Reservations ----------
router.post('/reservations', async (req, res) => {
  const { customerId, tableId, reservationDate, startTime, endTime, partySize } = req.body;
  const errors = validateReservation(req.body);
  if (errors.length) {
    return res.status(400).json({ errors });
  }
  try {
    // Is the table already booked at an overlapping time?
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

router.get('/reservations', async (req, res) => {
  const { customerId } = req.query;
  try {
    const result = customerId
      ? await pool.query(
          'SELECT * FROM reservation.reservation WHERE customer_id = $1 ORDER BY reservation_date, start_time',
          [customerId]
        )
      : await pool.query(
          'SELECT * FROM reservation.reservation ORDER BY reservation_date, start_time'
        );
    res.json(result.rows);
  } catch (err) {
    handleDbError(err, res);
  }
});

router.get('/reservations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM reservation.reservation WHERE reservation_id = $1',
      [req.params.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'reservation not found' });
    res.json(result.rows[0]);
  } catch (err) {
    handleDbError(err, res);
  }
});

router.patch('/reservations/:id/cancel', async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE reservation.reservation SET status = 'cancelled'
       WHERE reservation_id = $1 AND status = 'confirmed' RETURNING *`,
      [req.params.id]
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

router.patch('/reservations/:id', async (req, res) => {
  const { tableId, reservationDate, startTime, endTime, partySize } = req.body;
  try {
    // 1. Find the current reservation
    const current = await pool.query(
      'SELECT * FROM reservation.reservation WHERE reservation_id = $1',
      [req.params.id]
    );
    if (current.rowCount === 0) {
      return res.status(404).json({ error: 'reservation not found' });
    }
    const old = current.rows[0];
    if (old.status !== 'confirmed') {
      return res.status(400).json({ error: 'only confirmed reservations can be changed' });
    }

    // 2. Use the new value if one was sent, otherwise keep the old one
    const newTable = tableId ?? old.table_id;
    const newDate  = reservationDate ?? old.reservation_date;
    const newStart = startTime ?? old.start_time;
    const newEnd   = endTime ?? old.end_time;
    const newSize  = partySize ?? old.party_size;

    // Check the updated booking with the same rules
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

    // 3. Clash check, ignoring this reservation itself
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

    // 4. Save the changes
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
  if (err.code === '23P01') return res.status(409).json({ error: 'table is already booked at that time' });
  if (err.code === '23505') return res.status(409).json({ error: 'email already registered' });
  if (err.code === '23503') return res.status(400).json({ error: 'customer does not exist' });
  if (err.code === '23514') return res.status(400).json({ error: 'invalid values (check party size and times)' });
  if (err.code && err.code.startsWith('22')) return res.status(400).json({ error: 'wrong data format' });
  console.error(err);
  res.status(500).json({ error: 'server error' });
}

module.exports = router;