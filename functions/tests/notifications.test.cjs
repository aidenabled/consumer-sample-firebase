const {test} = require('node:test');
const assert = require('node:assert/strict');
const {AidenNotifications} = require('../lib/notifications');
const config = {baseUrl: 'https://api.example.test', username: 'demo', password: 'test-password',
  serviceUrl: 'https://service.example.test', title: 'Your service is ready', message: 'Open your service.'};

test('AiDEN adapter authenticates, requests a signed launch URL, and reuses its token', async () => {
  const calls = [];
  const client = new AidenNotifications(config, async (url, options) => {
    calls.push({url, options, body: JSON.parse(options.body)});
    return new Response(JSON.stringify(url.endsWith('/login') ? {accessToken: 'test-token', expiresIn: 3600} : {}), {status: 200});
  });
  await client.send('DEMO_VEHICLE', 'one');
  await client.send('DEMO_VEHICLE', 'two');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[0].body, {username: 'demo', password: 'test-password'});
  assert.equal(calls[1].url, 'https://api.example.test/consumer/api/v1/send-notification');
  assert.equal(calls[1].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(calls[1].body, {title: config.title, message: config.message,
    vin_numbers: ['DEMO_VEHICLE'], url_authentication_enabled: true, url: 'https://service.example.test/authorize'});
  assert.equal(calls[1].options.redirect, 'error');
  assert.ok(calls[1].options.signal);
});
test('explicit expired token is refreshed once; server errors are left for trigger retries', async () => {
  let authCalls = 0, notifications = 0;
  const client = new AidenNotifications(config, async url => {
    if (url.endsWith('/login')) {authCalls++; return Response.json({accessToken: `token-${authCalls}`, expiresIn: 3600});}
    notifications++;
    return new Response('{}', {status: notifications === 1 ? 401 : 200});
  });
  await client.send('DEMO_VEHICLE', 'one');
  assert.equal(authCalls, 2); assert.equal(notifications, 2);
  const unavailable = new AidenNotifications(config, async url => url.endsWith('/login') ?
    Response.json({accessToken: 'token', expiresIn: 3600}) : new Response('{}', {status: 503}));
  await assert.rejects(unavailable.send('DEMO_VEHICLE', 'two'), /notification failed \(503\)/);
});
test('notification configuration fails closed without sending credentials to HTTP URLs', async () => {
  let calls = 0;
  const http = async () => {calls++; return Response.json({});};
  await assert.rejects(new AidenNotifications({...config, password: ''}, http).send('DEMO_VEHICLE', 'one'), /Missing/);
  await assert.rejects(new AidenNotifications({...config, baseUrl: 'http://example.test'}, http).send('DEMO_VEHICLE', 'one'), /HTTPS/);
  assert.equal(calls, 0);
});
