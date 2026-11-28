require('dotenv').config();
const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./routes');

const app = express();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500')
  .split(',').map((value) => value.trim()).filter(Boolean);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.includes(origin));
  }
}));
app.use(express.json());
app.use('/', routes);

module.exports.handler = serverless(app); // Lambda entry point
module.exports.app = app;

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, (err) => {
    if (err) {
      console.error('Could not start:', err.message);
      process.exit(1);
    }
    console.log(`reservation-service on :${port}`);
  });
}
