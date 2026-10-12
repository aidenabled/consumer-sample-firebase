const {test} = require('node:test');
const assert = require('node:assert/strict');
const {generateKeyPairSync, sign} = require('node:crypto');
const v = require('../lib/validation');
const {actOnTrigger, vehicleState} = require('../lib/actions');

test('trigger envelopes validate every message and bound batch size and payload', () => {
  const message = {id: 'event/1', standard: {infoVin: 'DEMO_VEHICLE', gearSelection: 'GEAR_PARK'}};
  const [parsed] = v.triggerMessages({messages: [message]});
  assert.equal(actOnTrigger(parsed), 'Vehicle parked');
  assert.equal(actOnTrigger({...parsed, data: {standard: {}}}), 'Vehicle data updated');
  for (const body of [{messages: []}, {messages: [message, {}]}, {messages: Array(101).fill(message)},
    {messages: [{...message, standard: {infoVin: '../other'}}]}, {messages: [message], extra: 'x'.repeat(65536)}]) {
    assert.throws(() => v.triggerMessages(body), v.InputError);
  }
});
test('deduplication IDs are stable, scoped to vehicle, and safe for document paths', () => {
  assert.equal(v.recordId('one', '1/2'), v.recordId('one', '1/2'));
  assert.notEqual(v.recordId('one', '1/2'), v.recordId('two', '1/2'));
  assert.notEqual(v.recordId('a:b', 'c'), v.recordId('a', 'b:c'));
  assert.match(v.recordId('one', '1/2'), /^[a-f0-9]{64}$/);
});
test('authentication requires a non-empty exact secret', () => {
  assert.equal(v.matchesSecret('', ''), false);
  assert.equal(v.matchesSecret('Bearer right', 'Bearer right'), true);
  assert.equal(v.matchesSecret('Bearer wrong', 'Bearer right'), false);
});
test('launch signatures bind VIN, expiry, and nonce without a bypass', () => {
  const now = 1000000;
  const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
  const key = publicKey.export({format: 'der', type: 'spki'}).toString('base64');
  const query = {vin: 'DEMO_VEHICLE', expiry: '1100', nonce: 'test-nonce'};
  query.signature = sign('RSA-SHA256', Buffer.from('vin_number=DEMO_VEHICLE&expiry=1100&nonce=test-nonce'), privateKey).toString('base64');
  const launch = v.launchParameters(query, undefined, now);
  assert.equal(v.verifyLaunch(launch, key), true);
  assert.equal(v.verifyLaunch({...launch, vin: 'OTHER'}, key), false);
  assert.equal(v.verifyLaunch({...launch, signature: 'self'}, key), false);
  for (const altered of [{expiry: '1000'}, {expiry: '1301'}, {expiry: 'NaN'}, {nonce: ''}, {vin: '../other'}]) {
    assert.throws(() => v.launchParameters({...query, ...altered}, undefined, now), v.InputError);
  }
  assert.throws(() => v.launchParameters(query, 'OTHER', now), v.InputError);
});

test('vehicle movement overrides contradictory parking data', () => {
  const message = {id: 'event', vin: 'DEMO_VEHICLE', data: {standard: {gearSelection: 'GEAR_PARK', perfVehicleSpeed: 5}}};
  assert.equal(vehicleState(message), 'moving');
  assert.equal(vehicleState({...message, data: {standard: {gearSelection: 'GEAR_DRIVE'}}}), 'moving');
  assert.equal(vehicleState({...message, data: {standard: {parkingBrakeOn: true, perfVehicleSpeed: 0}}}), 'parked');
});
