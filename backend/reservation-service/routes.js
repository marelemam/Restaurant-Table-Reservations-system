const express = require('express');
const pool = require('./db');
const router = express.Router();

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

module.exports = router;