import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'

const PLUGIN_SERVER = 'https://na-api-nue-api-e7bfd3f4.koyeb.app'
const PAGES = [
  { id: 'dashboard', title: 'Dashboard' },
  { id: 'plugin', title: 'Plugin' },
  { id: 'ai', title: 'AI' },
  { id: 'stickerwm', title: 'Sticker WM' },
  { id: 'customcmd', title: 'Custom Command' },
  { id: 'features', title: 'Fitur' },
  { id: 'vipcode', title: 'VIP Code' },
  { id: 'logger', title: 'Logger' },
  { id: 'settings', title: 'Settings' },
]

function esc(s) { return String(s == null ? '' : s) }
function catClass(cat) {
  const c = String(cat || '').toLowerCase()
  if (c === 'music') return 'tag music'
  if (c === 'ai') return 'tag ai'
  return 'tag'
}
function formatDur(sec) {
  sec = Number(sec || 0)
  if (sec <= 0) return '0'
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}h ${h}j`
  if (h > 0) return `${h}j ${m}m`
  return `${m}m`
}

async function ensureQrLib() {
  if (window.QRCode) return
  if (window.__qrLibPromise) return window.__qrLibPromise
  window.__qrLibPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('QR lib gagal dimuat'))
    document.head.appendChild(s)
  })
  return window.__qrLibPromise
}

export default function App() {
  const [page, setPage] = useState('dashboard')
  const [drawer, setDrawer] = useState(false)
  const [status, setStatus] = useState(null)
  const [config, setConfig] = useState(null)
  const [isLogged, setIsLogged] = useState(false)
  const [globalMsg, setGlobalMsg] = useState({ text: '', err: false })

  // login/connect
  const [loginOwner, setLoginOwner] = useState('')
  const [loginBot, setLoginBot] = useState('')
  const [connMsg, setConnMsg] = useState({ text: '', err: false })
  const [qrData, setQrData] = useState('')
  const [showQr, setShowQr] = useState(false)
  const [showPair, setShowPair] = useState(false)
  const [pairCode, setPairCode] = useState('-')
  const qrRef = useRef(null)
  const qrTimerRef = useRef(null)

  // settings/ai/sticker forms
  const [settings, setSettings] = useState({
    bot_name: 'puruLocal Bot', owner_name: 'Owner', owner_number: '', bot_number: '',
    block_self_chat: true, read_chat: false, typing_before_reply: true, anti_spam: true,
    ai_system_prompt: '', sticker_pack: '', sticker_author: ''
  })
  const [settingsMsg, setSettingsMsg] = useState({ text: '', err: false })
  const [aiMsg, setAiMsg] = useState({ text: '', err: false })
  const [stickerMsg, setStickerMsg] = useState({ text: '', err: false })
  const [formTouched, setFormTouched] = useState(false)
  const formTouchedRef = useRef(false)
  const setFormTouchedFlag = (v) => { formTouchedRef.current = !!v; setFormTouched(!!v) }

  // plugins
  const [installed, setInstalled] = useState([])
  const [available, setAvailable] = useState([])
  const [availCat, setAvailCat] = useState('__all__')
  const [pluginLoading, setPluginLoading] = useState(false)
  const [availLoading, setAvailLoading] = useState(false)
  const [availErr, setAvailErr] = useState('')

  // custom commands
  const [customCmds, setCustomCmds] = useState([])
  const [ccMsg, setCcMsg] = useState({ text: '', err: false })
  const [ccForm, setCcForm] = useState({ name: '', command: '', category: '', response_type: 'text', response_text: '', media_url: '', caption: '' })

  // features & vip
  const [features, setFeatures] = useState([])
  const [vipCodes, setVipCodes] = useState([])
  const [vipMsg, setVipMsg] = useState({ text: '', err: false })
  const [vipDurVal, setVipDurVal] = useState(1)
  const [vipDurUnit, setVipDurUnit] = useState('d')
  const [vipMaxUses, setVipMaxUses] = useState(1)

  // logs
  const [logs, setLogs] = useState([])
  const [logsMsg, setLogsMsg] = useState({ text: '', err: false })

  const flash = (setter, text, err = false, ms = 1500) => {
    setter({ text, err })
    if (text && !err && ms) setTimeout(() => setter(m => (m.text === text ? { text: '', err: false } : m)), ms)
  }

  const applyConfigToForm = useCallback((c, force = false) => {
    if (!c) return
    setSettings(prev => {
      // saat form sedang diedit (belum disimpan), jangan timpa input user dari polling
      if (!force && formTouchedRef.current) {
        return prev
      }
      return {
        bot_name: c.bot_name || 'puruLocal Bot',
        owner_name: c.owner_name || '',
        owner_number: c.owner_number || '',
        bot_number: c.bot_number || c.owner_number || '',
        block_self_chat: c.block_self_chat !== false,
        read_chat: !!c.read_chat,
        typing_before_reply: c.typing_before_reply !== false,
        anti_spam: c.anti_spam !== false,
        ai_system_prompt: c.ai_system_prompt || '',
        sticker_pack: c.sticker_pack || '',
        sticker_author: c.sticker_author || '',
      }
    })
    if (force) setFormTouchedFlag(false)
    setLoginOwner(v => v || c.owner_number || '')
    setLoginBot(v => v || c.bot_number || c.owner_number || '')
  }, [])

  const refresh = useCallback(async (manual = false) => {
    try {
      const d = await api('/api/status')
      const s = d.status || {}
      const c = d.config || {}
      setStatus(s)
      setConfig(c)
      const logged = !!(s.has_session || s.logged_in)
      setIsLogged(logged)
      if (logged) applyConfigToForm(c, !!manual)
      else applyConfigToForm(c, false)
    } catch {
      if (isLogged && page === 'dashboard') setGlobalMsg({ text: 'Gagal memuat status (backend lokal aktif?)', err: true })
    }
  }, [applyConfigToForm, isLogged, page])

  useEffect(() => { refresh(true); const t = setInterval(() => refresh(false), 5000); return () => clearInterval(t) }, []) // eslint-disable-line

  // render QR image
  useEffect(() => {
    if (!showQr || !qrData) return
    let cancelled = false
    ;(async () => {
      try {
        await ensureQrLib()
        if (cancelled || !qrRef.current) return
        qrRef.current.innerHTML = ''
        // eslint-disable-next-line no-undef
        new QRCode(qrRef.current, { text: qrData, width: 220, height: 220 })
      } catch {
        if (qrRef.current) qrRef.current.textContent = qrData
      }
    })()
    return () => { cancelled = true }
  }, [qrData, showQr])

  const buildConfigBody = useCallback((overrides = {}) => {
    const c = config || {}
    const body = {
      bot_name: (settings.bot_name || '').trim() || 'puruLocal Bot',
      owner_name: (settings.owner_name || '').trim() || 'Owner',
      owner_number: (settings.owner_number || '').trim(),
      bot_number: (settings.bot_number || '').trim() || (settings.owner_number || '').trim(),
      block_self_chat: settings.block_self_chat,
      read_chat: settings.read_chat,
      typing_before_reply: settings.typing_before_reply,
      typing_delay_sec: c.typing_delay_sec || 1.5,
      anti_spam: settings.anti_spam,
      update_manifest_url: c.update_manifest_url || '',
      ai_system_prompt: settings.ai_system_prompt || '',
      sticker_pack: settings.sticker_pack || '',
      sticker_author: settings.sticker_author || '',
    }
    return { ...body, ...overrides }
  }, [config, settings])

  const saveConfig = async (body, setMsg) => {
    const d = await api('/api/config', { method: 'POST', body: JSON.stringify(body) })
    if (!d.ok) { setMsg({ text: d.error || 'Gagal menyimpan', err: true }); return false }
    setConfig(d.config || body)
    setFormTouchedFlag(false)
    flash(setMsg, 'Tersimpan.')
    refresh(false)
    return true
  }

  const saveSettings = async () => {
    const body = buildConfigBody()
    if (!body.owner_number) { setSettingsMsg({ text: 'Nomor owner wajib diisi.', err: true }); return }
    await saveConfig(body, setSettingsMsg)
  }
  const saveAI = async () => {
    const body = buildConfigBody({ ai_system_prompt: settings.ai_system_prompt || '' })
    if (!body.owner_number && config && config.owner_number) { body.owner_number = config.owner_number; body.bot_number = body.bot_number || body.owner_number }
    await saveConfig(body, setAiMsg)
  }
  const saveStickerWm = async () => {
    const body = buildConfigBody({ sticker_pack: settings.sticker_pack || '', sticker_author: settings.sticker_author || '' })
    if (!body.owner_number && config && config.owner_number) { body.owner_number = config.owner_number; body.bot_number = body.bot_number || body.owner_number }
    await saveConfig(body, setStickerMsg)
  }

  // login helpers
  const saveLoginConfig = async () => {
    const owner = String(loginOwner || '').trim()
    const bot = String(loginBot || owner).trim()
    const c = config || {}
    if (!owner) { setConnMsg({ text: 'Nomor owner wajib diisi.', err: true }); return null }
    const body = {
      bot_name: c.bot_name || 'puruLocal Bot', owner_name: c.owner_name || 'Owner',
      owner_number: owner, bot_number: bot || owner,
      block_self_chat: c.block_self_chat !== false, read_chat: !!c.read_chat,
      typing_before_reply: c.typing_before_reply !== false, typing_delay_sec: c.typing_delay_sec || 1.5,
      anti_spam: c.anti_spam !== false, update_manifest_url: c.update_manifest_url || '',
      ai_system_prompt: c.ai_system_prompt || '', sticker_pack: c.sticker_pack || '', sticker_author: c.sticker_author || '',
    }
    const d = await api('/api/config', { method: 'POST', body: JSON.stringify(body) })
    if (!d.ok) { setConnMsg({ text: d.error || 'Gagal simpan konfigurasi', err: true }); return null }
    setConfig(d.config || body)
    return body
  }

  const connectQR = async () => {
    const cfg = await saveLoginConfig()
    if (!cfg) return
    setShowQr(true); setShowPair(false); setConnMsg({ text: 'Meminta QR...', err: false }); setQrData('')
    const d = await api('/api/connect/qr', { method: 'POST' })
    if (d.ok && d.qr) {
      setConnMsg({ text: 'QR siap, silakan scan.', err: false })
      setQrData(d.qr)
      clearTimeout(qrTimerRef.current)
      qrTimerRef.current = setTimeout(() => { if (showQr || d.qr) connectQR() }, 20000)
    } else {
      setConnMsg({ text: d.error || d.event || 'Gagal', err: true })
    }
    refresh(false)
  }

  const connectPair = async () => {
    const cfg = await saveLoginConfig()
    if (!cfg) return
    setShowPair(true); setShowQr(false); setConnMsg({ text: 'Meminta pairing code...', err: false })
    const phone = loginBot || loginOwner
    const d = await api('/api/connect/pair', { method: 'POST', body: JSON.stringify({ phone }) })
    if (d.ok) { setPairCode(d.pairing_code || '-'); setConnMsg({ text: 'Pairing code diterima.', err: false }) }
    else { setConnMsg({ text: d.error || 'Gagal', err: true }) }
    refresh(false)
  }

  const toggleRun = async () => {
    if (status && status.paused) await api('/api/start', { method: 'POST' })
    else await api('/api/pause', { method: 'POST' })
    refresh(false)
  }
  const logoutBot = async () => {
    if (!window.confirm('Logout sesi WhatsApp di perangkat ini?')) return
    await api('/api/logout', { method: 'POST' })
    setShowQr(false); setShowPair(false); setQrData(''); setConnMsg({ text: '', err: false })
    setFormTouchedFlag(false); setIsLogged(false); setPage('dashboard')
    refresh(true)
  }

  // plugins
  const loadPlugins = useCallback(async () => {
    setPluginLoading(true)
    try {
      const d = await api('/api/plugins')
      setInstalled(Array.isArray(d.plugins) ? d.plugins : [])
    } catch { /* ignore */ }
    setPluginLoading(false)
  }, [])

  const loadAvailable = useCallback(async (silent = false) => {
    if (!silent) setAvailLoading(true)
    setAvailErr('')
    try {
      const d = await api('/api/plugins/available?server=' + encodeURIComponent(PLUGIN_SERVER))
      if (!d.ok) {
        setAvailable([]); setAvailErr(d.error || 'Gagal memuat plugin server')
      } else {
        const instIds = new Set(installed.map(p => String((p && (p.id || p.command)) || '').trim()).filter(Boolean))
        const instCmds = new Set(installed.map(p => String((p && p.command) || '').trim().toLowerCase()).filter(Boolean))
        const list = (d.plugins || []).filter(p => {
          const id = String((p && (p.id || p.command)) || '').trim()
          const cmd = String((p && p.command) || '').trim().toLowerCase()
          return !(id && instIds.has(id)) && !(cmd && instCmds.has(cmd))
        })
        setAvailable(list)
      }
    } catch {
      setAvailable([]); setAvailErr('Gagal memuat plugin server')
    }
    if (!silent) setAvailLoading(false)
  }, [installed])

  useEffect(() => { if (page === 'plugin') { loadPlugins(); } }, [page, loadPlugins])
  useEffect(() => { if (page === 'plugin') { loadAvailable(true) } }, [page, installed, loadAvailable])

  const installPlugin = async (p) => {
    const d = await api('/api/plugins/install', { method: 'POST', body: JSON.stringify(p) })
    if (!d.ok) alert(d.error || 'Gagal install')
    await loadPlugins()
  }
  const removePlugin = async (id) => {
    const d = await api('/api/plugins/remove', { method: 'POST', body: JSON.stringify({ id }) })
    if (!d.ok) alert(d.error || 'Gagal hapus')
    await loadPlugins()
  }

  const availCategories = useMemo(() => {
    const cats = Array.from(new Set(available.map(p => String((p && p.category) || '').trim()).filter(Boolean)))
    cats.sort((a, b) => a.localeCompare(b))
    return cats
  }, [available])
  useEffect(() => { if (availCat !== '__all__' && !availCategories.includes(availCat)) setAvailCat('__all__') }, [availCategories, availCat])
  const filteredAvailable = useMemo(() => {
    if (availCat === '__all__') return available
    return available.filter(p => String((p && p.category) || '').trim() === availCat)
  }, [available, availCat])

  // custom commands
  const loadCustomCmds = async () => {
    const d = await api('/api/customcmds')
    if (d.ok) setCustomCmds(d.commands || [])
  }
  useEffect(() => { if (page === 'customcmd') loadCustomCmds() }, [page])

  const addCustomCmd = async () => {
    setCcMsg({ text: 'Menyimpan...', err: false })
    const d = await api('/api/customcmds/add', { method: 'POST', body: JSON.stringify(ccForm) })
    if (!d.ok) { setCcMsg({ text: d.error || 'Gagal menambah', err: true }); return }
    flash(setCcMsg, 'Custom command ditambahkan.')
    setCcForm({ name: '', command: '', category: '', response_type: 'text', response_text: '', media_url: '', caption: '' })
    setCustomCmds(d.commands || [])
  }
  const toggleCustomCmd = async (id, enabled) => {
    const d = await api('/api/customcmds/toggle', { method: 'POST', body: JSON.stringify({ id, enabled }) })
    if (!d.ok) alert(d.error || 'Gagal mengubah status'); else setCustomCmds(d.commands || [])
  }
  const removeCustomCmd = async (id) => {
    if (!window.confirm('Hapus custom command ini?')) return
    const d = await api('/api/customcmds/remove', { method: 'POST', body: JSON.stringify({ id }) })
    if (!d.ok) alert(d.error || 'Gagal menghapus'); else setCustomCmds(d.commands || [])
  }

  // features
  const loadFeatures = async () => {
    const d = await api('/api/features')
    if (d.ok) setFeatures(d.features || [])
  }
  useEffect(() => { if (page === 'features') loadFeatures() }, [page])
  const toggleFeatureVip = async (id, vip) => {
    const d = await api('/api/features/toggle', { method: 'POST', body: JSON.stringify({ id, vip }) })
    if (!d.ok) { alert(d.error || 'Gagal mengubah'); await loadFeatures(); return }
    setFeatures(d.features || [])
  }

  // vip codes
  const loadVipCodes = async () => {
    const d = await api('/api/vipcodes')
    if (d.ok) setVipCodes(d.codes || [])
  }
  useEffect(() => { if (page === 'vipcode') loadVipCodes() }, [page])

  // logs
  const loadLogs = async (silent = false) => {
    try {
      const d = await api('/api/logs')
      if (d && d.ok && Array.isArray(d.logs)) setLogs(d.logs)
      else if (!silent) setLogsMsg({ text: d.error || 'Gagal memuat log', err: true })
    } catch (e) {
      if (!silent) setLogsMsg({ text: 'Gagal memuat log', err: true })
    }
  }
  useEffect(() => {
    if (page !== 'logger') return
    loadLogs(true)
    const t = setInterval(() => loadLogs(true), 4000)
    return () => clearInterval(t)
  }, [page])

  const copyLogs = async () => {
    const text = logs.length ? logs.map(l => `[${l.time}] [${String(l.level || '').toUpperCase()}] [${l.source || '-'}] ${l.message || ''}`).join('\n') : '(log kosong)'
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text)
      else { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t) }
      flash(setLogsMsg, 'Log disalin.')
    } catch {
      setLogsMsg({ text: 'Gagal menyalin log', err: true })
    }
  }
  const clearLogs = async () => {
    const d = await api('/api/logs/clear', { method: 'POST' })
    if (d && d.ok) { setLogs([]); flash(setLogsMsg, 'Log dibersihkan.') }
    else setLogsMsg({ text: (d && d.error) || 'Gagal membersihkan log', err: true })
  }

  const generateVipCode = async () => {
    const val = Math.max(1, parseInt(vipDurVal || 1, 10) || 1)
    const maxUses = Math.max(1, parseInt(vipMaxUses || 1, 10) || 1)
    const seconds = vipDurUnit === 'h' ? val * 3600 : val * 86400
    setVipMsg({ text: 'Membuat kode...', err: false })
    const d = await api('/api/vipcodes/generate', { method: 'POST', body: JSON.stringify({ duration_seconds: seconds, max_uses: maxUses }) })
    if (!d.ok) { setVipMsg({ text: d.error || 'Gagal generate', err: true }); return }
    const code = d.code && d.code.code ? d.code.code : ''
    setVipMsg({ text: code ? ('Kode dibuat: ' + code) : 'Kode dibuat.', err: false })
    setVipCodes(d.codes || [])
  }
  const copyVipCode = async (code) => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(code)
      else { const t = document.createElement('textarea'); t.value = code; document.body.appendChild(t); t.select(); document.execCommand('copy'); document.body.removeChild(t) }
      flash(setVipMsg, 'Kode ' + code + ' disalin.')
    } catch { alert('Gagal menyalin') }
  }
  const removeVipCode = async (code) => {
    if (!window.confirm('Hapus kode VIP ' + code + '?')) return
    const d = await api('/api/vipcodes/remove', { method: 'POST', body: JSON.stringify({ code }) })
    if (!d.ok) { setVipMsg({ text: d.error || 'Gagal menghapus', err: true }); return }
    flash(setVipMsg, 'Kode ' + code + ' dihapus.')
    setVipCodes(d.codes || [])
  }

  const checkUpdate = () => {
    const setM = page === 'settings' ? setSettingsMsg : setGlobalMsg
    try {
      if (window.PuruNative && window.PuruNative.postMessage) {
        setM({ text: 'Mengecek update...', err: false })
        window.PuruNative.postMessage('checkUpdate')
      } else {
        setM({ text: 'Tombol update aktif di aplikasi (WebView).', err: true })
      }
    } catch {
      setM({ text: 'Gagal memicu cek update.', err: true })
    }
  }

  useEffect(() => {
    window.puruUpdateDone = (msg, isErr) => {
      const setM = page === 'settings' ? setSettingsMsg : setGlobalMsg
      if (msg) flash(setM, msg, !!isErr, isErr ? 0 : 4000)
    }
    return () => { try { delete window.puruUpdateDone } catch {} }
  }, [page])

  const nav = (p) => { setPage(p); setDrawer(false) }
  const onField = (k) => (e) => { setFormTouchedFlag(true); const v = e && e.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e; setSettings(s => ({ ...s, [k]: v })) }

  const pageTitle = (PAGES.find(p => p.id === page) || PAGES[0]).title
  const paused = !!(status && status.paused)

  if (!isLogged) {
    return (
      <div className="app">
        <div className="brand" style={{ paddingTop: 6 }}>
          <div className="logo">P</div>
          <div>
            <div className="title">puruLocal Bot</div>
            <div className="subtitle">Login WhatsApp</div>
          </div>
        </div>
        <div className="card">
          <label>Nomor Owner (tanpa +)</label>
          <input type="text" placeholder="628123456789" value={loginOwner} onChange={e => setLoginOwner(e.target.value)} />
          <label>Nomor Bot</label>
          <input type="text" placeholder="628123456789" value={loginBot} onChange={e => setLoginBot(e.target.value)} />
          <div className="grid2 mt10">
            <button className="btn primary" onClick={connectQR}>Connect via QR</button>
            <button className="btn" onClick={connectPair}>Pairing Code</button>
          </div>
          {showPair && (
            <div className="mt10">
              <div className="muted">WhatsApp &gt; Perangkat tertaut &gt; Tautkan dengan nomor telepon</div>
              <div className="pair-code">{pairCode}</div>
            </div>
          )}
          {showQr && (
            <div>
              <div className="muted mt10">Scan QR dari WhatsApp &gt; Perangkat tertaut</div>
              <div className="qr-box" ref={qrRef}><span className="muted">{qrData ? '' : 'Menunggu QR...'}</span></div>
            </div>
          )}
          <div className={'msg' + (connMsg.err ? ' err' : '')}>{connMsg.text}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand">
          <div className="logo">P</div>
          <div>
            <div className="title">puruLocal Bot</div>
            <div className="subtitle">{pageTitle}</div>
          </div>
        </div>
        <button className="icon-btn" onClick={() => setDrawer(d => !d)} aria-label="Menu">☰</button>
      </div>

      {drawer && <div className="overlay" onClick={() => setDrawer(false)} />}
      <div className={'drawer' + (drawer ? ' open' : '')}>
        <div className="drawer-title">Menu</div>
        {PAGES.map(p => (
          <button key={p.id} className={'nav-item' + (page === p.id ? ' active' : '')} onClick={() => nav(p.id)}>{p.title}</button>
        ))}
      </div>

      {page === 'dashboard' && (
        <div className="page">
          <div className="card">
            <div className="card-h"><div className="card-title">Status</div><span className="pill ok">Aktif</span></div>
            <div className="status-grid">
              <div className="stat"><div className="k">Connected</div><div className="v">{String(!!(status && status.connected))}</div></div>
              <div className="stat"><div className="k">Logged in</div><div className="v">{String(!!(status && status.logged_in))}</div></div>
              <div className="stat"><div className="k">Paused</div><div className="v">{String(!!(status && status.paused))}</div></div>
              <div className="stat"><div className="k">Session</div><div className="v">{String(!!(status && status.has_session))}</div></div>
            </div>
            {status && status.jid ? <div className="muted mt8">JID: {status.jid}</div> : null}
            <button className={'btn mt10 ' + (paused ? 'primary' : 'warn')} onClick={toggleRun}>{paused ? '▶ Start' : '⏸ Pause'}</button>
            <button className="btn danger mt8" onClick={logoutBot}>Logout</button>
            <div className={'msg' + (globalMsg.err ? ' err' : '')}>{globalMsg.text}</div>
          </div>
        </div>
      )}

      {page === 'plugin' && (
        <div className="page">
          <div className="page-head">Plugin</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Plugin Terpasang</div></div>
            <div>
              {pluginLoading && !installed.length ? <span className="muted">Memuat plugin...</span> : null}
              {!pluginLoading && installed.length === 0 ? <span className="muted">Belum ada plugin terpasang.</span> : null}
              {installed.map(p => {
                const cmd = p.command || p.id || ''
                return (
                  <div className="plugin-item" key={p.id || cmd}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {p.category ? <span className={catClass(p.category)}>{p.category}</span> : null}
                        {p.name || cmd} <span className="muted">( .{cmd} )</span>
                      </div>
                      <div className="muted">{p.description || ''}</div>
                    </div>
                    <button className="small-btn danger" onClick={() => removePlugin(p.id || cmd)}>Hapus</button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-title">Plugin dari Server</div></div>
            <label>Category</label>
            <select value={availCat} onChange={e => setAvailCat(e.target.value)}>
              <option value="__all__">Semua Kategori</option>
              {availCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="mt10">
              {availLoading ? <span className="muted">Memuat...</span> : null}
              {!availLoading && availErr ? <span className="msg err">{availErr}</span> : null}
              {!availLoading && !availErr && available.length === 0 ? <span className="muted">Semua plugin dari server sudah terpasang.</span> : null}
              {!availLoading && !availErr && available.length > 0 && filteredAvailable.length === 0 ? <span className="muted">Tidak ada plugin di kategori ini.</span> : null}
              {filteredAvailable.map(p => {
                const cmd = p.command || ''
                return (
                  <div className="plugin-item" key={(p.id || cmd) + ':' + cmd}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {p.category ? <span className={catClass(p.category)}>{p.category}</span> : null}
                        {p.name || cmd} <span className="muted">( .{cmd} )</span>
                      </div>
                      <div className="muted">{p.description || ''}</div>
                    </div>
                    <button className="small-btn primary" onClick={() => installPlugin(p)}>Install</button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {page === 'ai' && (
        <div className="page">
          <div className="page-head">AI</div>
          <div className="card">
            <div className="card-h"><div className="card-title">System Prompt</div></div>
            <div className="muted mb8">Atur instruksi/system prompt untuk command <b>.ai</b>. Biarkan kosong untuk tanpa system prompt khusus.</div>
            <textarea value={settings.ai_system_prompt} onChange={onField('ai_system_prompt')} placeholder="Contoh: Kamu adalah asisten yang ramah dan menjawab dengan singkat..." />
            <button className="btn primary mt10" onClick={saveAI}>Simpan System Prompt</button>
            <div className={'msg' + (aiMsg.err ? ' err' : '')}>{aiMsg.text}</div>
          </div>
        </div>
      )}

      {page === 'stickerwm' && (
        <div className="page">
          <div className="page-head">Sticker WM</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Sticker Watermark</div></div>
            <div className="muted mb8">Atur copyright sticker (packname &amp; author) untuk perintah <b>.s</b> / <b>.sticker</b>.</div>
            <label>Pack Name</label>
            <input type="text" value={settings.sticker_pack} onChange={onField('sticker_pack')} placeholder="Nama pack sticker" />
            <label>Author</label>
            <input type="text" value={settings.sticker_author} onChange={onField('sticker_author')} placeholder="Nama author" />
            <button className="btn primary mt10" onClick={saveStickerWm}>Simpan Sticker WM</button>
            <div className={'msg' + (stickerMsg.err ? ' err' : '')}>{stickerMsg.text}</div>
          </div>
        </div>
      )}

      {page === 'customcmd' && (
        <div className="page">
          <div className="page-head">Custom Command</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Buat Custom Command</div></div>
            <label>Nama Command</label>
            <input type="text" value={ccForm.name} onChange={e => setCcForm(f => ({ ...f, name: e.target.value }))} placeholder="Nama tampilan" />
            <label>Command (tanpa titik)</label>
            <input type="text" value={ccForm.command} onChange={e => setCcForm(f => ({ ...f, command: e.target.value }))} placeholder="contoh: halo" />
            <label>Category</label>
            <input type="text" value={ccForm.category} onChange={e => setCcForm(f => ({ ...f, category: e.target.value }))} placeholder="contoh: CUSTOM" />
            <label>Respon</label>
            <select value={ccForm.response_type} onChange={e => setCcForm(f => ({ ...f, response_type: e.target.value }))}>
              <option value="text">Text</option>
              <option value="photo">Foto</option>
              <option value="video">Video</option>
              <option value="music">Music</option>
            </select>
            {ccForm.response_type === 'text' && (
              <>
                <label>Respon Text</label>
                <textarea style={{ minHeight: 100 }} value={ccForm.response_text} onChange={e => setCcForm(f => ({ ...f, response_text: e.target.value }))} placeholder="Isi respon teks..." />
              </>
            )}
            {(ccForm.response_type === 'photo' || ccForm.response_type === 'video' || ccForm.response_type === 'music') && (
              <>
                <label>URL Media</label>
                <input type="text" value={ccForm.media_url} onChange={e => setCcForm(f => ({ ...f, media_url: e.target.value }))} placeholder="https://..." />
              </>
            )}
            {(ccForm.response_type === 'photo' || ccForm.response_type === 'video') && (
              <>
                <label>Caption (opsional)</label>
                <input type="text" value={ccForm.caption} onChange={e => setCcForm(f => ({ ...f, caption: e.target.value }))} placeholder="Caption foto/video" />
              </>
            )}
            <button className="btn primary mt10" onClick={addCustomCmd}>Add</button>
            <div className={'msg' + (ccMsg.err ? ' err' : '')}>{ccMsg.text}</div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-title">Daftar Custom Command</div></div>
            <div>
              {customCmds.length === 0 ? <span className="muted">Belum ada custom command.</span> : customCmds.map(c => {
                const id = c.id || ''
                const enabled = c.enabled !== false
                return (
                  <div className="plugin-item" key={id || c.command}>
                    <div className="flex1">
                      <div style={{ fontWeight: 700, fontSize: 14 }}>
                        {c.category ? <span className={catClass(c.category)}>{c.category}</span> : null}
                        {c.name || c.command} <span className="muted">( .{c.command} )</span>{' '}
                        {enabled ? <span className="pill ok">Aktif</span> : <span className="pill">Mati</span>}
                      </div>
                      <div className="muted">Tipe: {c.response_type || 'text'}</div>
                    </div>
                    <div className="actions">
                      <button className="small-btn" onClick={() => toggleCustomCmd(id, !enabled)}>{enabled ? 'Matikan' : 'Aktifkan'}</button>
                      <button className="small-btn danger" onClick={() => removeCustomCmd(id)}>Hapus</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {page === 'features' && (
        <div className="page">
          <div className="page-head">Fitur</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Daftar Semua Fitur</div></div>
            <div className="muted mb8">Aktifkan toggle untuk menjadikan fitur sebagai VIP.</div>
            <div>
              {features.length === 0 ? <span className="muted">Tidak ada fitur.</span> : features.map(f => {
                const id = String(f.id || '')
                const vip = !!f.vip
                return (
                  <div className="row" key={id}>
                    <div className="l">
                      <div className="t">{f.name || f.command || id}{f.command ? <span className="muted"> ( .{f.command} )</span> : null}</div>
                      <div className="d">{f.type || ''}{vip ? <span> · <span style={{ color: 'var(--warn)' }}>VIP</span></span> : null}</div>
                    </div>
                    <label className="switch"><input type="checkbox" checked={vip} onChange={e => toggleFeatureVip(id, e.target.checked)} /><span className="slider" /></label>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {page === 'vipcode' && (
        <div className="page">
          <div className="page-head">VIP Code</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Generate VIP Code</div></div>
            <div className="muted mb8">Kode 4 karakter (huruf/angka). Redeem: <b>.vip KODE</b></div>
            <label>Durasi</label>
            <div className="grid2">
              <input type="number" min="1" value={vipDurVal} onChange={e => setVipDurVal(e.target.value)} />
              <select value={vipDurUnit} onChange={e => setVipDurUnit(e.target.value)}>
                <option value="h">Jam</option>
                <option value="d">Hari</option>
              </select>
            </div>
            <label>Maks penggunaan (jumlah user)</label>
            <input type="number" min="1" value={vipMaxUses} onChange={e => setVipMaxUses(e.target.value)} />
            <button className="btn primary mt10" onClick={generateVipCode}>Generate</button>
            <div className={'msg' + (vipMsg.err ? ' err' : '')}>{vipMsg.text}</div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-title">Daftar Kode</div></div>
            <div>
              {vipCodes.length === 0 ? <span className="muted">Belum ada kode.</span> : [...vipCodes].sort((a,b)=>(b.created_at||0)-(a.created_at||0)).map(c => {
                const raw = String(c.code || '')
                const maxUses = Math.max(1, parseInt(c.max_uses || 1, 10) || 1)
                const usedList = Array.isArray(c.used_by_users) ? c.used_by_users : ((c.used_by && String(c.used_by).trim()) ? [String(c.used_by).trim()] : [])
                const usedCount = usedList.length
                const exhausted = usedCount >= maxUses
                const dur = formatDur(c.duration_seconds || 0)
                return (
                  <div className="plugin-item" key={raw}>
                    <div className="flex1">
                      <div className="big-code">{raw} {exhausted ? <span className="muted">Habis</span> : <span className="pill ok">{usedCount}/{maxUses}</span>}</div>
                      <div className="muted">Durasi: {dur} · Terpakai {usedCount}/{maxUses} user</div>
                    </div>
                    <div className="actions">
                      <button className="small-btn primary" onClick={() => copyVipCode(raw)}>Salin</button>
                      <button className="small-btn danger" onClick={() => removeVipCode(raw)}>Hapus</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {page === 'logger' && (
        <div className="page">
          <div className="page-head">Logger</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Log Error & Event</div></div>
            <div className="muted mb8">Menampilkan log error/proses (mis. gagal download video TikTok) untuk membantu debug. Log bisa disalin.</div>
            <div className="actions" style={{justifyContent:'flex-start', marginBottom:10}}>
              <button className="small-btn" onClick={() => loadLogs(false)}>Refresh</button>
              <button className="small-btn primary" onClick={copyLogs}>Salin Semua</button>
              <button className="small-btn danger" onClick={clearLogs}>Bersihkan</button>
            </div>
            <div className={'msg' + (logsMsg.err ? ' err' : '')}>{logsMsg.text}</div>
            <div style={{maxHeight: '55vh', overflow:'auto', border:'1px solid var(--border)', borderRadius:12, padding:10, background:'#0b0f14'}}>
              {logs.length === 0 ? <span className="muted">Belum ada log.</span> : logs.slice().reverse().map((l, i) => {
                const level = String(l.level || 'info').toUpperCase()
                const color = level === 'ERROR' ? 'var(--danger)' : (level === 'WARN' ? 'var(--warn)' : 'var(--accent2)')
                return (
                  <div key={(l.time||'')+i} style={{padding:'8px 0', borderBottom:'1px solid var(--border)'}}>
                    <div style={{fontSize:11, color:'var(--muted)', marginBottom:2}}>{l.time || ''} <span style={{color, fontWeight:700}}>[{level}]</span> <span>[{l.source || '-'}]</span></div>
                    <div style={{fontSize:13, whiteSpace:'pre-wrap', wordBreak:'break-word'}}>{l.message || ''}</div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {page === 'settings' && (
        <div className="page">
          <div className="page-head">Settings</div>
          <div className="card">
            <div className="card-h"><div className="card-title">Profil Bot</div></div>
            <label>Nama Bot</label>
            <input type="text" value={settings.bot_name} onChange={onField('bot_name')} placeholder="puruLocal Bot" />
            <label>Nama Owner</label>
            <input type="text" value={settings.owner_name} onChange={onField('owner_name')} placeholder="Owner" />
            <label>Nomor Owner (tanpa +)</label>
            <input type="text" value={settings.owner_number} onChange={onField('owner_number')} placeholder="628123456789" />
            <label>Nomor Bot</label>
            <input type="text" value={settings.bot_number} onChange={onField('bot_number')} placeholder="628123456789" />
          </div>
          <div className="card">
            <div className="card-h"><div className="card-title">Perilaku</div></div>
            <div className="row"><div className="l"><div className="t">Bot tidak bisa chat diri sendiri</div><div className="d">Abaikan pesan dari diri sendiri</div></div><label className="switch"><input type="checkbox" checked={settings.block_self_chat} onChange={onField('block_self_chat')} /><span className="slider" /></label></div>
            <div className="row"><div className="l"><div className="t">Bot read chat</div><div className="d">Tandai pesan masuk sebagai dibaca</div></div><label className="switch"><input type="checkbox" checked={settings.read_chat} onChange={onField('read_chat')} /><span className="slider" /></label></div>
            <div className="row"><div className="l"><div className="t">Bot status mengetik</div><div className="d">Ketik 1.5 detik sebelum membalas command</div></div><label className="switch"><input type="checkbox" checked={settings.typing_before_reply} onChange={onField('typing_before_reply')} /><span className="slider" /></label></div>
            <div className="row"><div className="l"><div className="t">Anti-spam</div><div className="d">Ban 10 detik jika user mengirim pesan beruntun cepat (&lt;500 ms)</div></div><label className="switch"><input type="checkbox" checked={settings.anti_spam} onChange={onField('anti_spam')} /><span className="slider" /></label></div>
          </div>
          <div className="card">
            <div className="card-h"><div className="card-title">Aplikasi</div></div>
            <button className="btn" onClick={checkUpdate}>Cek Update Aplikasi</button>
            <button className="btn primary mt8" onClick={saveSettings}>Simpan Settings</button>
            <div className={'msg' + (settingsMsg.err ? ' err' : '')}>{settingsMsg.text}</div>
          </div>
        </div>
      )}
    </div>
  )
}
