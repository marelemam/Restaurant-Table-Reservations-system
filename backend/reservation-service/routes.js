const express = require('express');
const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ service: 'reservation-service', status: 'ok' });
});

module.exports = router;