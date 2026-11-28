const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../app');

test('table health endpoint is available', async () => {
  const response = await request(app).get('/api/tables/health');
  assert.equal(response.status, 200);
  assert.equal(response.body.service, 'table-service');
});

test('table listing requires authentication', async () => {
  const response = await request(app).get('/api/tables');
  assert.equal(response.status, 401);
});
