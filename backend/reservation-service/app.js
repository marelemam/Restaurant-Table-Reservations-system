require('dotenv').config();
const express = require('express');
const serverless = require('serverless-http');
const routes = require('./routes');

const app = express();
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