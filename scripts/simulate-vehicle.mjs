import {randomUUID} from 'node:crypto'
const state = process.argv[2] || 'parked'
if (!['parked', 'moving'].includes(state)) throw new Error('Use npm run simulate -- parked|moving')
const response = await fetch('http://127.0.0.1:5002/aiden/trigger', {
  method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer local-demo-trigger-secret'},
  body: JSON.stringify({messages: [{id: randomUUID(), standard: {infoVin: 'DEMO_VEHICLE',
    gearSelection: state === 'parked' ? 'GEAR_PARK' : 'GEAR_DRIVE', perfVehicleSpeed: state === 'parked' ? 0 : 5}}]}),
})
if (!response.ok) throw new Error(`Vehicle trigger failed (${response.status})`)
console.log(await response.json())
