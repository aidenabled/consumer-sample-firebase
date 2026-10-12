import {useEffect, useState} from 'react'
import {onAuthStateChanged, signInWithCustomToken} from 'firebase/auth'
import type {User} from 'firebase/auth'
import {auth, useEmulators} from './firebase'

type Activity = {id: string; title: string; receivedAt: string | null; notification: string}
type Feed = {items: Activity[]; vehicleState: 'parked' | 'moving' | 'unknown'}

const launchToken = new URLSearchParams(window.location.hash.slice(1)).get('token')
if (launchToken) window.history.replaceState(null, '', window.location.pathname)
let signIn: Promise<unknown> | undefined

async function connect() {
  if (launchToken) return signInWithCustomToken(auth, launchToken)
  if (useEmulators) {
    // Development identity only; vehicle events still arrive through the trigger endpoint.
    const response = await fetch('/api/demo-session')
    if (!response.ok) throw new Error('Unable to connect to the local vehicle session.')
    const data = await response.json()
    return signInWithCustomToken(auth, data.token)
  }
}

export default function App() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [feed, setFeed] = useState<Feed>({items: [], vehicleState: 'unknown'})
  const [error, setError] = useState('')
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (value) => {setUser(value); setReady(true)})
    signIn ??= connect()
    signIn.catch(() => setError('Connection unavailable. Open a new notification to reconnect.'))
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const controller = new AbortController()
    async function refresh() {
      try {
        if (document.visibilityState !== 'hidden') {
          const token = await user!.getIdToken()
          const response = await fetch('/api/activity', {
            headers: {Authorization: `Bearer ${token}`}, signal: controller.signal,
          })
          if (!response.ok) throw new Error('Vehicle updates are temporarily unavailable.')
          const data: Feed = await response.json()
          if (active) {setFeed(data); setError(''); setUpdated(true)}
        }
      } catch {
        if (active) setError('Connection interrupted. Reconnecting automatically…')
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 5000)
      }
    }
    void refresh()
    return () => {active = false; controller.abort(); clearTimeout(timer)}
  }, [user])

  const connected = ready && !!user
  const state = feed.vehicleState
  const heading = !connected ? 'Connecting to your vehicle' : !updated ? 'Waiting for vehicle data' :
    state === 'parked' ? 'Your vehicle is parked' : state === 'moving' ? 'Journey in progress' : 'Your service is connected'
  const description = !connected ? 'Open the service from your vehicle notification.' :
    state === 'moving' ? 'Your service will update when you park.' :
      'Updates arrive automatically from your vehicle.'
  const latest = feed.items[0]

  return <div className="shell">
    <header><span className="brand">Consumer service</span>
      <span className={`connection ${error ? 'offline' : ''}`} role="status">
        <span className="dot" />{error ? 'Reconnecting' : connected ? 'Connected' : 'Connecting'}
      </span>
    </header>
    <main className={state === 'moving' ? 'driving' : undefined}>
      <section className={`vehicle-status ${state}`} aria-labelledby="status-title">
        <div className="status-icon" aria-hidden="true">{state === 'parked' ? 'P' : state === 'moving' ? '↗' : '—'}</div>
        <div><p className="eyebrow">VEHICLE STATUS</p><h1 id="status-title">{heading}</h1>
          <p className="description">{description}</p>
          {latest?.receivedAt && <p className="updated">Last vehicle update <time dateTime={latest.receivedAt}>
            {new Date(latest.receivedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}
          </time></p>}
        </div>
      </section>
      {error && <p className="alert" role="alert">{error}</p>}
      {state !== 'moving' && <section className="activity-panel" aria-labelledby="activity-title">
        <h2 id="activity-title">Recent updates</h2>
        {feed.items.length ? <ul>{feed.items.slice(0, 3).map(item => <li key={item.id}>
          <span className="event-dot" aria-hidden="true" /><span className="event-title">{item.title}</span>
          <time dateTime={item.receivedAt || undefined}>{item.receivedAt ?
            new Date(item.receivedAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : 'Just now'}</time>
        </li>)}</ul> : <p className="empty">Waiting for your next vehicle update.</p>}
      </section>}
    </main>
    <footer><span>Powered by AiDEN</span><span>Updates automatically</span></footer>
  </div>
}
