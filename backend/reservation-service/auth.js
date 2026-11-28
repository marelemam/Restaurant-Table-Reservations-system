const pool = require('./db');
const { requireAuth } = require('../shared/auth');

function runMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    Promise.resolve(middleware(req, res, () => resolve(true)))
      .then(() => {
        if (res.headersSent) resolve(false);
      })
      .catch(reject);
  });
}

async function identify(req, res, next) {
  const authenticated = await runMiddleware(requireAuth, req, res);
  if (!authenticated || res.headersSent) return;

  if (req.user.role === 'staff' || req.user.role === 'admin') return next();
  if (req.user.customerId) return next();

  try {
    const result = await pool.query(
      'SELECT customer_id FROM reservation.customer WHERE cognito_sub = $1',
      [req.user.sub]
    );
    if (result.rowCount === 0) {
      return res.status(403).json({
        error: 'customer profile required',
        action: 'POST /customers'
      });
    }
    req.user.customerId = result.rows[0].customer_id;
    return next();
  } catch (error) {
    console.error('Customer identity lookup failed:', error.message);
    return res.status(500).json({ error: 'server error' });
  }
}

module.exports = { identify, requireAuth };
