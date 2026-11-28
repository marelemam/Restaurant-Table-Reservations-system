// Works out WHO is calling and puts it in req.user:
//   staff:    { role: 'staff', sub }
//   customer: { role: 'customer', customerId, sub }
//
// 1. Real login: "Authorization: Bearer <Cognito token>" is checked with the
//    team's shared verifyToken (signature, expiry, issuer, app client).
//    Users in the Cognito group "staff" are staff; everyone else is a customer.
//    A customer's Cognito ID (sub) is linked to their row in reservation.customer.
// 2. Stand-in ID headers (x-user-role / x-customer-id): LOCAL TESTING ONLY,
//    accepted only when ALLOW_FAKE_AUTH=true, which is never set on Lambda.

const pool = require('./db');
const { logEvent, logWarn } = require('./logger');

// Locally the shared code is at backend/shared; in the Lambda zip it sits next to this file.
let shared;
try {
  shared = require('./shared/auth');
} catch (err) {
  if (err.code !== 'MODULE_NOT_FOUND') throw err;
  shared = require('../shared/auth');
}

async function identify(req, res, next) {
  const header = req.get('authorization') || '';
  const match = header.match(/^Bearer (.+)$/i);

  if (match) {
    return identifyWithCognito(req, res, next, match[1]);
  }
  if (process.env.ALLOW_FAKE_AUTH === 'true') {
    return identifyWithStandIn(req, res, next);
  }

  logWarn('AUTH_FAILED', { reason: 'missing_token', method: req.method, path: req.originalUrl });
  return res.status(401).json({ error: 'please log in' });
}

async function identifyWithCognito(req, res, next, token) {
  let claims;
  try {
    claims = await shared.verifyToken(token);
  } catch (err) {
    if (err.code === 'JWKS_UNAVAILABLE' || err.code === 'AUTH_CONFIG') {
      logWarn('AUTH_SERVICE_UNAVAILABLE', { reason: err.message });
      return res.status(503).json({ error: 'login service is unavailable, please try again shortly' });
    }
    // Never log the token itself, only why it was refused
    logWarn('AUTH_FAILED', { reason: err.message, method: req.method, path: req.originalUrl });
    return res.status(401).json({ error: 'please log in again' });
  }

  const groups = claims['cognito:groups'] || [];
  if (groups.includes('staff')) {
    req.user = { role: 'staff', sub: claims.sub };
    return next();
  }

  try {
    const customerId = await customerIdForLogin(claims);
    req.user = { role: 'customer', customerId, sub: claims.sub };
    return next();
  } catch (err) {
    if (err.status) {
      logWarn('CUSTOMER_LINK_FAILED', { reason: err.message, sub: claims.sub });
      return res.status(err.status).json({ error: err.message });
    }
    console.error(JSON.stringify({ type: 'SERVER_ERROR', service: 'reservation-service', where: 'auth', message: err.message }));
    return res.status(500).json({ error: 'server error' });
  }
}

// Finds the customer row for this Cognito user, linking or creating it on first login.
async function customerIdForLogin(claims) {
  // Already linked?
  const linked = await pool.query(
    'SELECT customer_id FROM reservation.customer WHERE cognito_sub = $1',
    [claims.sub]
  );
  if (linked.rowCount) return linked.rows[0].customer_id;

  // First login: we need a verified email to link or create the customer
  const email = claims.email;
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!email || !verified) {
    throw Object.assign(new Error('your account needs a verified email address'), { status: 403 });
  }

  // Link to an existing customer with that email (only if not linked to someone else),
  // or create a new customer.
  const result = await pool.query(
    `INSERT INTO reservation.customer (name, email, cognito_sub)
     VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET cognito_sub = EXCLUDED.cognito_sub
       WHERE reservation.customer.cognito_sub IS NULL
     RETURNING customer_id`,
    [claims['cognito:username'] || claims.username || email, email, claims.sub]
  );
  if (!result.rowCount) {
    throw Object.assign(new Error('this email is already linked to another login'), { status: 409 });
  }

  logEvent('CUSTOMER_LINKED', { customerId: result.rows[0].customer_id, sub: claims.sub });
  return result.rows[0].customer_id;
}

function identifyWithStandIn(req, res, next) {
  const role = req.get('x-user-role');
  const customerId = Number(req.get('x-customer-id'));

  if (role === 'staff') {
    req.user = { role: 'staff' };
    return next();
  }
  if (role === 'customer' && Number.isInteger(customerId) && customerId > 0) {
    req.user = { role: 'customer', customerId };
    return next();
  }
  logWarn('AUTH_FAILED', { reason: 'missing_or_invalid_id', method: req.method, path: req.originalUrl });
  return res.status(401).json({ error: 'please log in' });
}

module.exports = { identify };