const { Pool, types } = require('pg');

// Return DATE columns as plain text ("2026-12-01") instead of converting them
types.setTypeParser(1082, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

module.exports = pool;