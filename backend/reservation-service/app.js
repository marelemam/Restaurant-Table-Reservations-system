require('dotenv').config({ quiet: true });
const express = require('express');
const serverless = require('serverless-http');
const routes = require('./routes');

const app = express();

// ---------- CORS: which web pages may call this service ----------
// Browsers block a page on one address (e.g. localhost:8081) from calling
// another (localhost:3001) unless the server says that page is allowed.
// Only addresses listed in CORS_ORIGINS get in, comma-separated.
const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  const origin = req.get('origin');

  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Role, X-Customer-Id');
    res.set('Access-Control-Max-Age', '600');
  }

  // The browser's "may I?" check before the real request
  if (req.method === 'OPTIONS') {
    return res.sendStatus(origin && allowedOrigins.includes(origin) ? 204 : 403);
  }

  next();
});

app.use(express.json());
app.use('/', routes);

module.exports.handler = serverless(app); // Lambda entry point

if (require.main === module) {
  app.listen(3001, (err) => {
    if (err) {
      console.error('Could not start:', err.message);
      process.exit(1);
    }
    console.log('reservation-service on :3001');
  });
}