// POST /auth/login   { username, password }   ->   { idToken, expiresIn }
//
// The customer app can't call Cognito on Floci directly (the browser blocks it: CORS),
// so this service signs the customer in on their behalf and hands back the ID token.
// The password is only passed on to Cognito. It is never stored or logged.

const { logEvent, logWarn } = require('./logger');

// Simple guard against password guessing: at most 10 attempts per 5 minutes per address.
// (Kept in memory, so on Lambda each warm container counts separately.)
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map(); // ip -> { count, since }

function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.since > WINDOW_MS) {
    attempts.set(ip, { count: 1, since: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

// Cognito's address: COGNITO_ENDPOINT if set, otherwise worked out from COGNITO_ISSUER
// (e.g. issuer http://localhost:4566/us-east-1_abc  ->  http://localhost:4566/)
function cognitoEndpoint() {
  if (process.env.COGNITO_ENDPOINT) return process.env.COGNITO_ENDPOINT;
  if (process.env.COGNITO_ISSUER) return `${new URL(process.env.COGNITO_ISSUER).origin}/`;
  return null;
}

function registerLogin(router) {
  router.post('/auth/login', async (req, res) => {
    const { username, password } = req.body || {};

    if (typeof username !== 'string' || typeof password !== 'string' ||
        !username.trim() || !password || username.length > 128 || password.length > 256) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    if (tooManyAttempts(req.ip)) {
      logWarn('LOGIN_RATE_LIMITED', { ip: req.ip });
      return res.status(429).json({ error: 'too many sign-in attempts, please wait a few minutes' });
    }

    const endpoint = cognitoEndpoint();
    const clientId = process.env.COGNITO_CLIENT_ID;
    if (!endpoint || !clientId) {
      logWarn('AUTH_SERVICE_UNAVAILABLE', { reason: 'cognito is not configured' });
      return res.status(503).json({ error: 'sign-in is not available right now' });
    }

    let response;
    let payload;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-amz-json-1.1',
          'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
        },
        body: JSON.stringify({
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId: clientId,
          AuthParameters: { USERNAME: username.trim(), PASSWORD: password },
        }),
        signal: AbortSignal.timeout(5000),
      });
      payload = await response.json().catch(() => ({}));
    } catch (err) {
      logWarn('AUTH_SERVICE_UNAVAILABLE', { reason: `cannot reach cognito (${err.name})` });
      return res.status(503).json({ error: 'sign-in is not available right now' });
    }

    const result = payload.AuthenticationResult;
    if (response.ok && result?.IdToken) {
      logEvent('LOGIN_SUCCEEDED', { username: username.trim() });
      return res.json({ idToken: result.IdToken, expiresIn: result.ExpiresIn });
    }

    if (response.ok && payload.ChallengeName) {
      logWarn('LOGIN_FAILED', { username: username.trim(), reason: payload.ChallengeName });
      return res.status(403).json({ error: 'this account needs a new password before it can sign in' });
    }

    if (response.status >= 500) {
      logWarn('AUTH_SERVICE_UNAVAILABLE', { reason: `cognito answered ${response.status}` });
      return res.status(503).json({ error: 'sign-in is not available right now' });
    }

    logWarn('LOGIN_FAILED', { username: username.trim(), reason: payload.__type || `status ${response.status}` });
    // Same answer for a wrong password and an unknown user, so nobody can find out which usernames exist
    return res.status(401).json({ error: 'incorrect username or password' });
  });
}

module.exports = { registerLogin };