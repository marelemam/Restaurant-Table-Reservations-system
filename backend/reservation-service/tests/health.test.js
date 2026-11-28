const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { app } = require('../app');

test('reservation health endpoint is available', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.service, 'reservation-service');
});

test('reservation endpoints require authentication', async () => {
  const response = await request(app).get('/reservations');
  assert.equal(response.status, 401);
});

test('customer profile creation requires authentication', async () => {
  const response = await request(app)
    .post('/customers')
    .send({ name: 'Test User', email: 'test@example.com' });
  assert.equal(response.status, 401);
});
