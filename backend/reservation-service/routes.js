const express = require('express');
const pool = require('./db');
const { validateReservation, validateSlot, toMinutes } = require('./validation');
const { sendConfirmation, sendCancellation } = require('./notifications');
const { identify } = require('./auth');
const { logEvent, logWarn } = require('./logger');
const tables = require('./tablesClient');
const { registerLogin } = require('./loginRoute');
const router = express.Router();

// Sign-in on behalf of the customer app (POST /auth/login)
registerLogin(router);

// ---------- Health checks ----------
router.get('/health', (req, res) => {
  res.json({ service: 'reservation-service', status: 'ok', tables: tables.mode() });
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
    logEvent('CUSTOMER_REGISTERED', { customerId: result.rows[0].customer_id });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    handleError(err, res);
  }
});

// ---------- Everything below needs a logged-in user ----------
router.use('/reservations', identify);
router.use('/availability', identify);

// Customers are limited to their own id. Staff get null, meaning "no limit".
function ownerLimit(user) {
  return user.role === 'customer' ? user.customerId : null;
}

// Who is calling, for the logs
function who(req) {
  return { role: req.user.role, userCustomerId: req.user.customerId ?? null };
}

// Rules that depend on the table and on Mariam's booking policy
function checkTableRules(table, policy, slot) {
  if (!table) return ['table does not exist'];

  const errors = [];
  if (table.operational_status === 'maintenance') {
    errors.push(`table ${table.table_number} is under maintenance`);
  }
  if (slot.partySize > table.capacity) {
    errors.push(`table ${table.table_number} seats only ${table.capacity} people`);
  }
  const duration = toMinutes(slot.endTime) - toMinutes(slot.startTime);
  if (policy.maxDurationMinutes && duration > policy.maxDurationMinutes) {
    errors.push(`bookings can be at most ${policy.maxDurationMinutes} minutes`);
  }
  return errors;
}

// Is the table already taken? The cleaning gap (buffer) counts as taken too.
// excludeId skips the booking being edited.
async function findClash(tableId, date, startTime, endTime, bufferMinutes, excludeId = null) {
  const result = await pool.query(
    `SELECT 1 FROM reservation.reservation
     WHERE table_id = $1 AND reservation_date = $2 AND status = 'confirmed'
       AND start_time < ($4::time + make_interval(mins => $5::int))
       AND (end_time + make_interval(mins => $5::int)) > $3::time
       AND ($6::int IS NULL OR reservation_id <> $6)
     LIMIT 1`,
    [tableId, date, startTime, endTime, bufferMinutes, excludeId]
  );
  return result.rowCount > 0;
}

// ---------- Availability search (function #1) ----------
// GET /availability?date=2026-12-01&start=19:00&end=21:00&partySize=4
router.get('/availability', async (req, res) => {
  const slot = {
    reservationDate: req.query.date,
    startTime: req.query.start,
    endTime: req.query.end,
    partySize: Number(req.query.partySize),
  };

  const errors = validateSlot(slot);
  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const auth = req.get('authorization');
  try {
    // Ask Mariam's service which tables fit, and what the policy is
    const [suitable, policy] = await Promise.all([
      tables.getSuitableTables(slot.partySize, auth),
      tables.getPolicy(auth),
    ]);

    const duration = toMinutes(slot.endTime) - toMinutes(slot.startTime);
    if (policy.maxDurationMinutes && duration > policy.maxDurationMinutes) {
      return res.status(400).json({ errors: [`bookings can be at most ${policy.maxDurationMinutes} minutes`] });
    }

    // Which tables are already booked (including the cleaning gap) at that time?
    const booked = await pool.query(
      `SELECT DISTINCT table_id FROM reservation.reservation
       WHERE reservation_date = $1 AND status = 'confirmed'
         AND start_time < ($3::time + make_interval(mins => $4::int))
         AND (end_time + make_interval(mins => $4::int)) > $2::time`,
      [slot.reservationDate, slot.startTime, slot.endTime, policy.bufferMinutes]
    );
    const bookedIds = new Set(booked.rows.map((row) => row.table_id));

    const free = suitable
      .filter((t) => !bookedIds.has(t.table_id))
      .map((t) => ({
        table_id: t.table_id,
        table_number: t.table_number,
        capacity: t.capacity,
        location: t.location,
      }));

    logEvent('AVAILABILITY_SEARCHED', {
      ...who(req), reservationDate: slot.reservationDate, partySize: slot.partySize,
      found: free.length, source: tables.mode(),
    });

    res.json({
      date: slot.reservationDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
      partySize: slot.partySize,
      bufferMinutes: policy.bufferMinutes,
      maxDurationMinutes: policy.maxDurationMinutes,
      tables: free,
    });
  } catch (err) {
    handleError(err, res);
  }
});

// ---------- Create: customers book for themselves, staff for anyone ----------
router.post('/reservations', async (req, res) => {
  const body = { ...req.body };
  if (req.user.role === 'customer') {
    body.customerId = req.user.customerId;
  }

  const errors = validateReservation(body);
  if (errors.length) {
    logWarn('VALIDATION_FAILED', { ...who(req), action: 'create', errors });
    return res.status(400).json({ errors });
  }
  const { customerId, tableId, reservationDate, startTime, endTime, partySize } = body;
  const auth = req.get('authorization');

  try {
    // Ask Mariam's service about this table and the booking policy
    const [table, policy] = await Promise.all([
      tables.getTable(tableId, auth),
      tables.getPolicy(auth),
    ]);

    const tableErrors = checkTableRules(table, policy, body);
    if (tableErrors.length) {
      logWarn('TABLE_CHECK_FAILED', { ...who(req), action: 'create', tableId, errors: tableErrors });
      return res.status(400).json({ errors: tableErrors });
    }

    if (await findClash(tableId, reservationDate, startTime, endTime, policy.bufferMinutes)) {
      logWarn('BOOKING_CONFLICT', { ...who(req), source: 'app', tableId, reservationDate, startTime, endTime });
      return res.status(409).json({
        error: policy.bufferMinutes
          ? `table is already booked at that time (tables need ${policy.bufferMinutes} minutes between bookings)`
          : 'table is already booked at that time',
      });
    }

    const result = await pool.query(
      `INSERT INTO reservation.reservation
         (customer_id, table_id, reservation_date, start_time, end_time, party_size)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [customerId, tableId, reservationDate, startTime, endTime, partySize]
    );
    const r = result.rows[0];
    logEvent('RESERVATION_CREATED', {
      ...who(req), reservationId: r.reservation_id, customerId: r.customer_id,
      tableId: r.table_id, reservationDate: r.reservation_date,
    });
    const emailSent = await notify(r, 'confirmed');
    res.status(201).json({ ...r, table_number: table.table_number, emailSent });
  } catch (err) {
    handleError(err, res);
  }
});

// ---------- List: customers see only theirs, staff see all (or ?customerId=) ----------
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
    handleError(err, res);
  }
});

// ---------- View one ----------
router.get('/reservations/:id', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM reservation.reservation
       WHERE reservation_id = $1 AND ($2::int IS NULL OR customer_id = $2)`,
      [req.params.id, ownerLimit(req.user)]
    );
    if (result.rowCount === 0) {
      logWarn('RESERVATION_NOT_FOUND_OR_NOT_OWNED', { ...who(req), action: 'view', reservationId: req.params.id });
      return res.status(404).json({ error: 'reservation not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    handleError(err, res);
  }
});

// ---------- Cancel ----------
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
      logWarn('RESERVATION_NOT_FOUND_OR_NOT_OWNED', { ...who(req), action: 'cancel', reservationId: req.params.id });
      return res.status(404).json({ error: 'no confirmed reservation with that id' });
    }
    const r = result.rows[0];
    logEvent('RESERVATION_CANCELLED', { ...who(req), reservationId: r.reservation_id, customerId: r.customer_id });
    const emailSent = await notify(r, 'cancelled');
    res.json({ ...r, emailSent });
  } catch (err) {
    handleError(err, res);
  }
});

// ---------- Modify ----------
router.patch('/reservations/:id', async (req, res) => {
  const { tableId, reservationDate, startTime, endTime, partySize } = req.body;
  try {
    const current = await pool.query(
      `SELECT * FROM reservation.reservation
       WHERE reservation_id = $1 AND ($2::int IS NULL OR customer_id = $2)`,
      [req.params.id, ownerLimit(req.user)]
    );
    if (current.rowCount === 0) {
      logWarn('RESERVATION_NOT_FOUND_OR_NOT_OWNED', { ...who(req), action: 'modify', reservationId: req.params.id });
      return res.status(404).json({ error: 'reservation not found' });
    }
    const old = current.rows[0];
    if (old.status !== 'confirmed') {
      return res.status(400).json({ error: 'only confirmed reservations can be changed' });
    }

    const updated = {
      customerId: old.customer_id,
      tableId: tableId ?? old.table_id,
      reservationDate: reservationDate ?? old.reservation_date,
      startTime: startTime ?? old.start_time,
      endTime: endTime ?? old.end_time,
      partySize: partySize ?? old.party_size,
    };

    const errors = validateReservation(updated);
    if (errors.length) {
      logWarn('VALIDATION_FAILED', { ...who(req), action: 'modify', reservationId: old.reservation_id, errors });
      return res.status(400).json({ errors });
    }

    const auth = req.get('authorization');
    const [table, policy] = await Promise.all([
      tables.getTable(updated.tableId, auth),
      tables.getPolicy(auth),
    ]);

    const tableErrors = checkTableRules(table, policy, updated);
    if (tableErrors.length) {
      logWarn('TABLE_CHECK_FAILED', { ...who(req), action: 'modify', reservationId: old.reservation_id, errors: tableErrors });
      return res.status(400).json({ errors: tableErrors });
    }

    if (await findClash(updated.tableId, updated.reservationDate, updated.startTime, updated.endTime,
                        policy.bufferMinutes, old.reservation_id)) {
      logWarn('BOOKING_CONFLICT', { ...who(req), source: 'app', action: 'modify', reservationId: old.reservation_id, tableId: updated.tableId });
      return res.status(409).json({ error: 'table is already booked at that time' });
    }

    const result = await pool.query(
      `UPDATE reservation.reservation
       SET table_id = $1, reservation_date = $2, start_time = $3, end_time = $4, party_size = $5
       WHERE reservation_id = $6 RETURNING *`,
      [updated.tableId, updated.reservationDate, updated.startTime, updated.endTime,
       updated.partySize, old.reservation_id]
    );
    logEvent('RESERVATION_MODIFIED', { ...who(req), reservationId: old.reservation_id, customerId: old.customer_id });
    res.json(result.rows[0]);
  } catch (err) {
    handleError(err, res);
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
    logWarn('EMAIL_FAILED', { reservationId: reservation.reservation_id, reason: err.message });
    return false;
  }
}

// ---------- Turn errors into clear replies ----------
function handleError(err, res) {
  if (err.code === 'TABLE_SERVICE_UNAVAILABLE') {
    logWarn('TABLE_SERVICE_UNAVAILABLE', { reason: err.message, status: err.status });
    return res.status(503).json({ error: 'table information is unavailable right now, please try again shortly' });
  }
  if (err.code === '23P01') {
    logWarn('BOOKING_CONFLICT', { source: 'database_rule' });
    return res.status(409).json({ error: 'table is already booked at that time' });
  }
  if (err.code === '23505') return res.status(409).json({ error: 'email already registered' });
  if (err.code === '23503') return res.status(400).json({ error: 'customer does not exist' });
  if (err.code === '23514') return res.status(400).json({ error: 'invalid values (check party size and times)' });
  if (err.code && err.code.startsWith('22')) return res.status(400).json({ error: 'wrong data format' });
  console.error(JSON.stringify({ type: 'SERVER_ERROR', service: 'reservation-service', code: err.code, message: err.message }));
  res.status(500).json({ error: 'server error' });
}

module.exports = router;