export async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  const t = await r.text()
  try {
    return JSON.parse(t)
  } catch {
    return { ok: false, error: t || String(r.status) }
  }
}
