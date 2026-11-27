// Works out WHO is calling and puts it in req.user.
// TEMPORARY: reads a stand-in ID from request headers, for local testing only.
// Will be replaced with Cognito once the team sets it up.
function identify(req, res, next) {
  if (process.env.ALLOW_FAKE_AUTH !== 'true') {
    return res.status(401).json({ error: 'please log in' });
  }

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
  return res.status(401).json({ error: 'please log in' });
}

module.exports = { identify };