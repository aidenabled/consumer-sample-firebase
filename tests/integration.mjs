import assert from 'node:assert/strict'
import {sign} from 'node:crypto'

// Run through Hosting so rewrites are exercised alongside the Function handlers.
const base = 'http://127.0.0.1:5002'
const project = 'demo-consumer-sample'
async function guest() {
  const response = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({returnSecureToken: true}),
  })
  assert.equal(response.status, 200)
  return response.json()
}
async function api(path, token, method = 'GET', body) {
  return fetch(`${base}/api/${path}`, {method,
    headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
    ...(body === undefined ? {} : {body: JSON.stringify(body)}),
  })
}
const page = await fetch(base)
assert.equal(page.status, 200)
assert.match(await page.text(), /Consumer service/)
assert.equal((await api('activity', 'invalid')).status, 401)
const a = await guest(), b = await guest()
assert.equal((await api('submissions', a.idToken, 'POST', {title: 'Removed', message: 'Removed'})).status, 404)
assert.equal((await api('demo-trigger', a.idToken, 'POST', {})).status, 404)
assert.equal((await (await api('activity', a.idToken)).json()).items.length, 0)
const payload = {messages: [{id: 'integration-event', standard: {infoVin: a.localId, gearSelection: 'GEAR_PARK'}}]}
async function trigger(body, authorization = 'Bearer local-demo-trigger-secret') {
  return fetch(`${base}/aiden/trigger`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: authorization}, body: JSON.stringify(body)})
}
assert.equal((await trigger(payload, 'Bearer wrong')).status, 401)
assert.equal((await trigger({messages: [...payload.messages, {}]})).status, 400)
assert.equal((await (await api('activity', a.idToken)).json()).items.length, 0)
const first = await trigger(payload)
assert.equal(first.status, 200)
assert.deepEqual((await first.json()).success, ['integration-event'])
const retries = await Promise.all([trigger(payload), trigger(payload)])
for (const response of retries) assert.deepEqual((await response.json()).duplicates, ['integration-event'])
assert.equal((await (await api('activity', a.idToken)).json()).items.length, 1)
assert.equal((await (await api('activity', b.idToken)).json()).items.length, 0)

const parked = await (await api('activity', a.idToken)).json()
assert.equal(parked.vehicleState, 'parked')
assert.equal(parked.items[0].notification, 'simulated')
assert.equal(parked.items[0].title, 'Vehicle parked')
const continuedParking = {messages: [{...payload.messages[0], id: 'parked-again'}]}
assert.equal((await trigger(continuedParking)).status, 200)
let feed = await (await api('activity', a.idToken)).json()
assert.equal(feed.items.find(x => x.messageId === 'parked-again').notification, 'not-needed')
assert.equal((await trigger({messages: [{id: 'moving', standard: {infoVin: a.localId, gearSelection: 'GEAR_DRIVE', perfVehicleSpeed: 5}}]})).status, 200)
assert.equal((await trigger({messages: [{...payload.messages[0], id: 'parked-after-journey'}]})).status, 200)
feed = await (await api('activity', a.idToken)).json()
assert.equal(feed.items.find(x => x.messageId === 'parked-after-journey').notification, 'simulated')
const demoResponse = await fetch(`${base}/api/demo-session`)
assert.equal(demoResponse.status, 200)
assert.ok((await demoResponse.json()).token)

// Client SDKs cannot bypass the API, even when authenticated.
const firestore = `http://127.0.0.1:8080/v1/projects/${project}/databases/(default)/documents`
for (const token of [undefined, a.idToken, b.idToken]) {
  const headers = token ? {Authorization: `Bearer ${token}`} : {}
  const read = await fetch(`${firestore}/users/${a.localId}/activity`, {headers})
  assert.equal(read.status, 403)
  const write = await fetch(`${firestore}/users/${a.localId}/activity?documentId=unauthorized`, {
    method: 'POST', headers: {...headers, 'Content-Type': 'application/json'}, body: JSON.stringify({fields: {}}),
  })
  assert.equal(write.status, 403)
}

// Emulated signed launch, with a temporary key supplied by the runner.
const privateKey = process.env.TEST_SIGNING_PRIVATE_KEY
const nonce = `nonce-${Date.now()}`
const expiry = Math.floor(Date.now() / 1000) + 120
const signature = sign('RSA-SHA256', Buffer.from(`vin_number=SIGNED_VEHICLE&expiry=${expiry}&nonce=${nonce}`), privateKey).toString('base64')
const url = `${base}/authorize?${new URLSearchParams({vin: 'SIGNED_VEHICLE', expiry: String(expiry), nonce, signature})}`
const launch = await fetch(url, {redirect: 'manual'})
assert.equal(launch.status, 303)
assert.match(launch.headers.get('location'), /^\/auth#token=/)
const customToken = new URL(launch.headers.get('location'), base).hash.slice(7)
const exchange = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-api-key', {
  method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token: decodeURIComponent(customToken), returnSecureToken: true}),
})
assert.equal(exchange.status, 200)
const signedUser = await exchange.json()
assert.equal(JSON.parse(Buffer.from(signedUser.idToken.split('.')[1], 'base64url').toString()).sub, 'SIGNED_VEHICLE')
assert.equal((await api('activity', signedUser.idToken)).status, 200)
assert.equal((await fetch(url, {redirect: 'manual'})).status, 409)
assert.equal((await fetch(url.replace(encodeURIComponent(signature), 'self'), {redirect: 'manual'})).status, 401)
console.log('Integration passed: hosted page, vehicle-driven triggers, notification decisions, retries, isolation, rules, signed launch, replay rejection.')
