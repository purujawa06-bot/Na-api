'use client';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Image from 'next/image';

/* PurTV ala purtv.vercel.app — bg #0f1117, card #161922, blue #3b82f6 */
const API = '/api/purtv';
const LS_H = 'puruTV_history';
const LS_T = 'puruTV_trash';
const asArray = (v) => (Array.isArray(v) ? v : []);
const asString = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const isSeriesUrl = (u = '') => /\/seri\/|\/anime\//.test(u || '');
async function fetchJson(path) {
  const r = await fetch(path);
  const j = await r.json().catch(() => { throw new Error('Respons tidak valid'); });
  if (!j.success) throw new Error(j.error || 'Gagal memuat');
  return j;
}
function loadLS(k, fb) { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(fb) ? (Array.isArray(v) ? v : fb) : v ?? fb; } catch { return fb; } }

const Hero = ({ items, onClick }) => {
  const list = asArray(items).slice(0, 8);
  const [idx, setIdx] = useState(0);
  useEffect(() => { if (list.length < 2) return; const t = setInterval(() => setIdx(i => (i + 1) % list.length), 6000); return () => clearInterval(t); }, [list.length]);
  if (!list.length) return null;
  const cur = list[idx] || {};
  return (
    <div className="hero-wrap">
      <button onClick={() => onClick(cur)} className="hero-main text-left">
        <div key={idx} className="hero-img hero-kenburns">
          {cur.thumbnail && <Image src={cur.thumbnail} alt="" fill sizes="100vw" className="object-cover" unoptimized priority />}
        </div>
        <div className="hero-grad" />
        <div className="hero-info hero-fade-up" key={'t' + idx}>
          <span className="hero-tag"><i className="fas fa-fire mr-1" />Unggulan {idx + 1}/{list.length}</span>
          <div className="hero-title">{asString(cur.title)}</div>
          {cur.description && <div className="hero-desc">{asString(cur.description).slice(0, 130)}</div>}
          <span className="hero-play"><i className="fas fa-play mr-2" />Tonton Sekarang</span>
        </div>
        <div className="hero-dots">{list.map((_, i) => <span key={i} onClick={(e) => { e.stopPropagation(); setIdx(i); }} className={'hero-dot' + (i === idx ? ' on' : '')} />)}</div>
        <div className="hero-bar"><span key={'p' + idx} className="hero-progress" /></div>
      </button>
    </div>
  );
};

const Card = ({ item, onClick }) => {
  if (!item) return null;
  const title = asString(item.title) || 'Tanpa Judul';
  const ep = asString(item.episode || item.nextEpisode || item.releaseTime);
  const isAnime = item.source === 'samehadaku' || /samehadaku/i.test(item.url || '');
  return (
    <div onClick={() => onClick(item)} className="card-poster">
      <div className="relative aspect-poster bg-black overflow-hidden">
        {item.thumbnail ? <Image src={item.thumbnail} alt={title} fill sizes="220px" className="object-cover" unoptimized loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-gray-700"><i className="fas fa-film text-2xl" /></div>}
        {ep && <span className="ep-badge">{ep}</span>}
        <span className={'src-badge ' + (isAnime ? 'anime' : 'donghua')}>{isAnime ? 'Anime' : 'Donghua'}</span>
        <div className="play-overlay"><span className="play-btn"><i className="fas fa-play" /></span></div>
        <div className="card-grad" />
      </div>
      <div className="card-body"><div className="card-title">{title}</div>{item.type && <div className="card-sub">{asString(item.type)}</div>}</div>
    </div>
  );
};

const Sec = ({ icon, title, count, onMore }) => (
  <div className="sec-head"><span className="sec-bar" /><i className={'fas ' + icon + ' sec-ico'} /><h3 className="sec-title">{title}</h3>{count > 0 && <span className="sec-count">{count}</span>}<span className="flex-1" />{onMore && <button onClick={onMore} className="sec-more">Lihat Semua <i className="fas fa-chevron-right ml-1" /></button>}</div>
);

const Row = ({ items, onClick }) => {
  const l = asArray(items);
  if (!l.length) return null;
  return <div className="row-scroll">{l.map((it, i) => <div key={i} className="row-item"><Card item={it} onClick={onClick} /></div>)}</div>;
};

function EpisodeView({ episode, onBack, onOpenSeries, onOpenEpisode, onWatched }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [src, setSrc] = useState(null);
  const [srvLoad, setSrvLoad] = useState(false);
  const [active, setActive] = useState(null);
  const [srvErr, setSrvErr] = useState(null);
  const [extra, setExtra] = useState(null);
  const resolve = useCallback(async (s, slug) => {
    if (!s) return;
    if (s.url && !s.post) { setSrc(s.url); setActive(s); return; }
    if (!s.post || !s.nume) return;
    setSrvLoad(true); setSrvErr(null); setActive(s);
    try {
      const qs = new URLSearchParams({ post: asString(s.post), nume: asString(s.nume), type: asString(s.type) || 'schtml', slug: asString(slug) || '' });
      const r = await fetch(API + '/player?' + qs.toString());
      const j = await r.json();
      if (j.success && j.iframe) setSrc(j.iframe); else throw new Error(j.error || 'Gagal player');
    } catch (e) { setSrvErr(e.message); } finally { setSrvLoad(false); }
  }, []);
  useEffect(() => {
    let on = true;
    setLoading(true); setErr(null); setD(null); setSrc(null); setActive(null); setExtra(null);
    if (!episode?.url) { setErr('URL tidak valid'); setLoading(false); return; }
    fetchJson(API + '/detail?url=' + encodeURIComponent(episode.url)).then((dd) => {
      if (!on) return;
      setD(dd);
      if (dd.defaultIframe) setSrc(dd.defaultIframe);
      else { const ls = asArray(dd.streamingLinks); const f = ls.find(x => x?.post && x?.nume) || ls.find(x => x?.url) || ls[0]; if (f) resolve(f, dd.episodeSlug); }
      if (dd.seriesUrl && (!dd.thumbnail || !dd.synopsis)) fetchJson(API + '/series?url=' + encodeURIComponent(dd.seriesUrl)).then(sd => { if (on) setExtra(sd); }).catch(() => {});
      if (onWatched) onWatched({ episodeTitle: dd.title || episode.title, seriesTitle: dd.series || episode.title, url: episode.url, seriesUrl: dd.seriesUrl, thumbnail: dd.thumbnail || episode.thumbnail });
    }).catch(e => { if (on) setErr(e.message); }).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [episode?.url]);
  const links = asArray(d?.streamingLinks);
  const dls = asArray(d?.downloadLinks);
  const nav = d?.navigation || {};
  const thumb = d?.thumbnail || extra?.poster || episode?.thumbnail;
  return (
    <div className="anim-in">
      <div className="top-bar"><button onClick={onBack} className="icon-btn2"><i className="fas fa-arrow-left" /></button><div className="flex-1 min-w-0"><h2 className="top-title">{asString(d?.title || episode?.title)}</h2><span className="top-sub">{asString(d?.series || 'Detail Episode')}</span></div>{d?.seriesUrl && <button onClick={() => onOpenSeries(d.seriesUrl, d.series)} className="icon-btn2"><i className="fas fa-tv" /></button>}</div>
      {loading && <div className="panel py-10 flex flex-col items-center gap-3"><span className="inline-spinner" /><p className="text-xs text-gray-400">Memuat player...</p></div>}
      {err && !loading && <div className="panel p-6 text-center"><p className="text-xs text-gray-300 mb-3">{err}</p><button onClick={() => window.location.reload()} className="btn-primary px-4 py-2 rounded-xl text-xs font-bold">Coba Lagi</button></div>}
      {d && !loading && (
        <>
          <div className="panel overflow-hidden mb-3">
            <div className="relative w-full aspect-video bg-black">
              {srvLoad && <div className="absolute inset-0 flex items-center justify-center bg-black/70 z-10"><span className="inline-spinner" /></div>}
              {src ? <iframe key={src} src={src} className="absolute inset-0 w-full h-full" allowFullScreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" referrerPolicy="no-referrer" /> : !srvLoad && <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">{srvErr || 'Player tidak tersedia'}</div>}
            </div>
            <div className="p-3 flex gap-2 border-t border-white/5">
              <button disabled={!nav.prev} onClick={() => nav.prev && onOpenEpisode({ url: nav.prev, title: 'Prev' })} className="srv-btn flex-1 disabled:opacity-30"><i className="fas fa-backward mr-1" />Prev</button>
              <button disabled={!nav.next} onClick={() => nav.next && onOpenEpisode({ url: nav.next, title: 'Next' })} className="srv-btn flex-1 disabled:opacity-30">Next<i className="fas fa-forward ml-1" /></button>
              {nav.allEpisodes && <button onClick={() => onOpenSeries(nav.allEpisodes, d.series)} className="srv-btn flex-1"><i className="fas fa-list mr-1" />Semua</button>}
            </div>
          </div>
          {thumb && <div className="panel p-3 mb-3 flex gap-3"><div className="relative w-20 h-28 rounded-xl overflow-hidden bg-black flex-shrink-0"><Image src={thumb} alt="" fill sizes="80px" className="object-cover" unoptimized /></div><div className="flex-1 min-w-0 flex flex-col justify-center"><h3 className="text-sm font-bold text-white">{asString(d.title)}</h3>{d.series && <div className="text-[11px] text-blue-400 font-semibold truncate mt-1">{asString(d.series)}</div>}{d.episode && <span className="chip-blue self-start mt-2">EP {asString(d.episode)}</span>}</div></div>}
          {links.length > 0 && <div className="panel p-3 mb-3"><h4 className="mini-head"><i className="fas fa-server mr-2 text-blue-400" />Pilih Server</h4><div className="flex flex-wrap gap-2">{links.map((s, i) => <button key={i} onClick={() => resolve(s, d.episodeSlug)} className={'srv-btn' + (active === s ? ' on' : '')}>{asString(s.server || 'Server ' + (i + 1))}</button>)}</div></div>}
          {(d.synopsis || extra?.synopsis) && <div className="panel p-4 mb-3"><h4 className="mini-head"><i className="fas fa-align-left mr-2 text-blue-400" />Sinopsis</h4><p className="text-xs text-gray-300 leading-relaxed">{asString(d.synopsis || extra.synopsis)}</p></div>}
          {dls.length > 0 && <div className="panel p-3 mb-3"><h4 className="mini-head"><i className="fas fa-download mr-2 text-blue-400" />Download</h4>{dls.slice(0, 6).map((x, i) => <div key={i} className="dl-row mb-2"><div className="text-[11px] font-bold text-white">{asString(x.quality || 'Mirror')}</div><div className="flex flex-wrap gap-1.5 mt-1">{asArray(x.links).slice(0, 6).map((l, j) => <a key={j} href={typeof l === 'string' ? l : l.link} target="_blank" rel="noreferrer" className="dl-link">{asString(typeof l === 'string' ? 'Link' : l.host || 'Link')}</a>)}</div></div>)}</div>}
        </>
      )}
    </div>
  );
}

function SeriesView({ series, onBack, onOpenEpisode }) {
  const [d, setD] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [asc, setAsc] = useState(true);
  const [q, setQ] = useState('');
  useEffect(() => {
    let on = true;
    setLoading(true); setErr(null);
    fetchJson(API + '/series?url=' + encodeURIComponent(series.url)).then(x => { if (on) setD(x); }).catch(e => { if (on) setErr(e.message); }).finally(() => { if (on) setLoading(false); });
    return () => { on = false; };
  }, [series?.url]);
  const eps = useMemo(() => { let l = asArray(d?.episodes); if (q.trim()) l = l.filter(e => (asString(e.title) + ' ' + asString(e.episode)).toLowerCase().includes(q.toLowerCase())); return asc ? l : [...l].reverse(); }, [d, asc, q]);
  if (loading) return <div className="anim-in"><div className="top-bar"><button onClick={onBack} className="icon-btn2"><i className="fas fa-arrow-left" /></button><h2 className="top-title">{asString(series?.title)}</h2></div><div className="panel p-4"><div className="skel h-44 mb-3" /><div className="skel h-4 w-2/3" /></div></div>;
  if (err) return <div className="panel p-6 text-center"><p className="text-xs text-gray-300 mb-3">{err}</p><button onClick={onBack} className="btn-primary px-4 py-2 rounded-xl text-xs font-bold">Kembali</button></div>;
  const poster = d?.poster || series?.thumbnail;
  return (
    <div className="anim-in">
      <div className="top-bar"><button onClick={onBack} className="icon-btn2"><i className="fas fa-arrow-left" /></button><div className="flex-1 min-w-0"><h2 className="top-title">{asString(d?.title)}</h2><span className="top-sub">{asArray(d?.episodes).length} episode</span></div><button onClick={() => setAsc(!asc)} className={'icon-btn2 btn-sort-flip' + (asc ? '' : ' is-flipped')}><i className="fas fa-sort-amount-down" /></button></div>
      <div className="panel overflow-hidden mb-3"><div className="flex gap-4 p-4">{poster && <div className="relative w-28 h-40 rounded-xl overflow-hidden bg-black flex-shrink-0"><Image src={poster} alt="" fill sizes="112px" className="object-cover" unoptimized /></div>}<div className="flex-1 min-w-0"><h3 className="text-base font-extrabold text-white mb-1">{asString(d?.title)}</h3>{d?.rating && <div className="text-[11px] text-amber-400 font-bold mb-1"><i className="fas fa-star mr-1" />{asString(d.rating)}</div>}<div className="flex flex-wrap gap-1.5 mb-2">{asArray(d?.genres).map((g, i) => <span key={i} className="genre-chip">{typeof g === 'string' ? g : asString(g.name || g.slug)}</span>)}</div>{d?.synopsis && <p className="text-[11px] text-gray-300 line-clamp-5">{asString(d.synopsis)}</p>}</div></div></div>
      <div className="panel p-3"><h4 className="mini-head"><i className="fas fa-list-ol mr-2 text-blue-400" />Daftar Episode ({eps.length})</h4><div className="relative mb-3"><input value={q} onChange={e => setQ(e.target.value)} placeholder="Cari episode..." className="search-input pl-9" /><i className="fas fa-search absolute left-3.5 top-3 text-gray-500 text-xs" /></div><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{eps.map((ep, i) => <button key={i} onClick={() => onOpenEpisode(ep)} className="ep-cell"><div className="text-[11px] font-bold text-white line-clamp-2">{asString(ep?.title || ep?.episode) || 'Episode ' + (i + 1)}</div>{ep?.episode && <div className="text-[9px] text-blue-400 font-bold mt-1">EP {asString(ep.episode)}</div>}</button>)}</div></div>
    </div>
  );
}

export default function PurTVPage() {
  const [splash, setSplash] = useState(true);
  const [view, setView] = useState('home');
  const [home, setHome] = useState(null);
  const [genres, setGenres] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [tab, setTab] = useState('home');
  const [genre, setGenre] = useState('');
  const [search, setSearch] = useState('');
  const [input, setInput] = useState('');
  const [suggest, setSuggest] = useState([]);
  const [showSg, setShowSg] = useState(false);
  const [selS, setSelS] = useState(null);
  const [selE, setSelE] = useState(null);
  const [showSch, setShowSch] = useState(false);
  const [showHis, setShowHis] = useState(false);
  const [day, setDay] = useState(0);
  const [his, setHis] = useState([]);
  const [trash, setTrash] = useState([]);
  const [recT, setRecT] = useState(0);
  const tm = useRef(null);

  useEffect(() => { const t = setTimeout(() => setSplash(false), 1200); return () => clearTimeout(t); }, []);
  useEffect(() => { setHis(loadLS(LS_H, [])); setTrash(loadLS(LS_T, [])); }, []);
  const saveHT = (h, t) => { try { localStorage.setItem(LS_H, JSON.stringify(h)); localStorage.setItem(LS_T, JSON.stringify(t)); } catch {} };
  const onWatched = useCallback((it) => { setHis(p => { const n = [{ ...it, time: Date.now() }, ...p.filter(x => x.url !== it.url)].slice(0, 100); saveHT(n, loadLS(LS_T, [])); return n; }); }, []);

  const loadHome = useCallback(async () => {
    setLoading(true); setErr(null);
    try { const h = await fetchJson(API + '/home'); setHome(h); try { const g = await fetchJson(API + '/genres'); setGenres(asArray(g.genres)); } catch {} }
    catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, []);
  const loadList = useCallback(async (t = tab, g = genre, qq = search) => {
    setLoading(true); setErr(null);
    try {
      let dd;
      if (t === 'search' && qq) dd = await fetchJson(API + '/search?q=' + encodeURIComponent(qq));
      else { const p = new URLSearchParams(); if (g) p.set('genre', g); dd = await fetchJson(API + '/list?' + p.toString()); }
      let items = asArray(dd.results ?? dd.items);
      if (t === 'anime') items = items.filter(x => x?.source === 'samehadaku' || /samehadaku/i.test(x?.url || ''));
      if (t === 'donghua') items = items.filter(x => x?.source === 'anichin' || /anichin/i.test(x?.url || ''));
      setList({ ...dd, items });
    } catch (e) { setErr(e.message); } finally { setLoading(false); }
  }, [tab, genre, search]);

  useEffect(() => { loadHome(); }, [loadHome]);
  useEffect(() => { if (tab !== 'home') loadList(tab, genre, search); }, [tab, genre, search]);

  const openSch = async () => { setShowSch(true); if (!schedule) { try { setSchedule(await fetchJson(API + '/schedule')); } catch {} } };
  const onInput = (v) => {
    setInput(v);
    if (tm.current) clearTimeout(tm.current);
    if (!v.trim()) { setSuggest([]); setShowSg(false); return; }
    tm.current = setTimeout(async () => { try { const dd = await fetchJson(API + '/search?q=' + encodeURIComponent(v.trim())); setSuggest(asArray(dd.results).slice(0, 6)); setShowSg(true); } catch {} }, 450);
  };
  const openEp = (ep) => { if (!ep?.url) return; setShowSg(false); setSelE(ep); setView('episode'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openSe = (url, title, th = null) => { const u = typeof url === 'string' ? url : url?.url; if (!u) return; setShowSg(false); setSelS({ url: u, title: asString(title), thumbnail: th }); setView('series'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const clickCard = (it) => { if (!it?.url) return; if (isSeriesUrl(it.url) || it.isSeries) openSe(it.url, it.title, it.thumbnail); else openEp(it); };
  const doSearch = (e, preset) => { e?.preventDefault(); const qv = (preset ?? input).trim(); if (!qv) return; setSearch(qv); setInput(qv); setShowSg(false); setTab('search'); setGenre(''); setView('list'); };
  const chTab = (t) => { setTab(t); setGenre(''); setSearch(''); setInput(''); setShowSg(false); setView(t === 'home' ? 'home' : 'list'); };
  const goBack = () => { setView(tab === 'home' ? 'home' : 'list'); setSelS(null); setSelE(null); };

  const featured = asArray(home?.featuredSlider ?? home?.featured);
  const latest = asArray(home?.latestReleases ?? home?.latest);
  const popular = asArray(home?.popularToday ?? home?.popular);
  const ongoing = asArray(home?.ongoing);
  const animeL = Array.isArray(home?.anime) ? home.anime : asArray(home?.anime?.latestAnime);
  const animeP = Array.isArray(home?.anime) ? [] : asArray(home?.anime?.popularAnime);
  const recG = asArray(home?.recommendations?.genres);
  const recI = asArray(home?.recommendations?.items);
  const allG = genres.length ? genres : recG.map(g => ({ name: g.name, slug: g.id || g.name }));
  const items = asArray(list?.items);
  const days = asArray(schedule?.schedule);
  const curD = days[day] || days[0];

  return (
    <div className="purtv-scope">
      <style>{`
.purtv-scope{--bg:#0f1117;--card:#161922;--blue:#3b82f6;--border:#1f2535;background:var(--bg);color:#e5e7eb;border-radius:1.25rem;overflow:hidden;min-height:70vh;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
.anim-in{animation:fadeUp .35s cubic-bezier(.16,1,.3,1)}@keyframes fadeUp{from{transform:translateY(14px);opacity:0}to{transform:translateY(0);opacity:1}}
.pur-splash{position:fixed;inset:0;background:#0f1117;z-index:9999;display:flex;align-items:center;justify-content:center}.wave-wrap{display:flex;flex-direction:column;align-items:center;gap:1rem}.wave-txt{position:relative;font-size:3.2rem;font-weight:900;color:#1f232dcc}.wave-txt:after{content:"PURTV";position:absolute;inset:0;color:var(--blue);overflow:hidden;animation:waveFill 1.2s ease-in-out infinite;border-bottom:4px solid var(--blue)}@keyframes waveFill{0%,100%{height:0}50%{height:100%}}.wave-sub{font-size:10px;font-weight:900;color:var(--blue);letter-spacing:.4em}
.purtv-head{position:sticky;top:0;z-index:40;background:#161922e6;backdrop-filter:blur(15px);border-bottom:1px solid var(--border);padding:.7rem .9rem}.logo{font-weight:900;font-size:1.25rem;color:#fff}.logo b{color:var(--blue)}
.search-input{width:100%;background:#0f1117;border:1px solid var(--border);border-radius:.8rem;padding:.6rem .8rem;font-size:.75rem;color:#fff;outline:none}.search-input:focus{border-color:var(--blue)}
.hbtn{width:2.5rem;height:2.5rem;display:flex;align-items:center;justify-content:center;background:#0f1117;border:1px solid #374151;border-radius:.8rem;color:#9ca3af;flex-shrink:0}.suggest{position:absolute;top:110%;left:0;right:0;background:var(--card);border:1px solid var(--border);border-radius:1rem;overflow:hidden;z-index:50}.suggest button{display:flex;gap:.6rem;align-items:center;width:100%;padding:.55rem .7rem;text-align:left}.suggest button:hover{background:rgba(59,130,246,.1)}
.tabs{display:flex;gap:.5rem;overflow-x:auto;padding:.7rem .9rem;scrollbar-width:none}.tabs::-webkit-scrollbar{display:none}.tab{flex-shrink:0;font-size:.68rem;font-weight:900;text-transform:uppercase;padding:.55rem .95rem;border-radius:.8rem;border:1px solid var(--border);background:var(--card);color:#9ca3af}.tab.on{background:linear-gradient(135deg,var(--blue),#2563eb);color:#fff;border-color:transparent}
.hero-wrap{padding:.4rem .9rem 0}.hero-main{position:relative;display:block;width:100%;border-radius:1.25rem;overflow:hidden;min-height:210px;background:#000;border:1px solid rgba(255,255,255,.06)}.hero-img{position:absolute;inset:0}.hero-kenburns{animation:heroZoom 7s ease-out forwards}@keyframes heroZoom{from{transform:scale(1.05)}to{transform:scale(1.18)}}.hero-grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.92),transparent 60%)}.hero-info{position:absolute;left:0;right:0;bottom:0;padding:1rem;z-index:2}.hero-fade-up{animation:heroFadeUp .6s both}@keyframes heroFadeUp{from{transform:translateY(18px);opacity:0}to{transform:translateY(0);opacity:1}}.hero-tag{font-size:.6rem;font-weight:900;background:var(--blue);color:#fff;padding:.25rem .6rem;border-radius:.5rem;display:inline-block;margin-bottom:.5rem}.hero-title{font-size:1.05rem;font-weight:900;color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.hero-desc{font-size:.7rem;color:#cbd5e1;margin-top:.3rem;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.hero-play{display:inline-flex;margin-top:.6rem;font-size:.68rem;font-weight:900;background:#fff;color:#000;padding:.5rem .9rem;border-radius:.7rem}.hero-dots{position:absolute;top:.8rem;right:.8rem;display:flex;gap:.3rem;z-index:3}.hero-dot{width:.45rem;height:.45rem;border-radius:99px;background:#ffffff40}.hero-dot.on{background:var(--blue);width:1.2rem}.hero-bar{position:absolute;bottom:0;left:0;right:0;height:3px;background:#ffffff15}.hero-progress{display:block;height:100%;background:linear-gradient(90deg,var(--blue),#60a5fa);animation:heroDash 6s linear forwards}@keyframes heroDash{from{width:0}to{width:100%}}
.grid-r{display:grid;grid-template-columns:repeat(2,1fr);gap:.9rem;padding:0 .9rem}@media(min-width:640px){.grid-r{grid-template-columns:repeat(3,1fr)}}@media(min-width:1024px){.grid-r{grid-template-columns:repeat(5,1fr)}}
.card-poster{background:var(--card);border-radius:1.1rem;overflow:hidden;cursor:pointer;border:1px solid rgba(255,255,255,.05);transition:.3s}.card-poster:hover{transform:translateY(-6px);border-color:rgba(59,130,246,.5)}.aspect-poster{aspect-ratio:2/3}.ep-badge{position:absolute;top:.55rem;left:.55rem;color:#fff;font-size:.58rem;font-weight:900;padding:.2rem .55rem;border-radius:.5rem;background:linear-gradient(135deg,#3b82f6,#2563eb);z-index:10}.src-badge{position:absolute;top:.55rem;right:.55rem;font-size:.55rem;font-weight:900;padding:.2rem .5rem;border-radius:.5rem;color:#fff;z-index:10}.src-badge.anime{background:rgba(59,130,246,.92)}.src-badge.donghua{background:rgba(244,63,94,.92)}.play-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:.3s;background:linear-gradient(to top,rgba(59,130,246,.4),transparent);z-index:5}.card-poster:hover .play-overlay{opacity:1}.play-btn{width:2.6rem;height:2.6rem;border-radius:99px;background:var(--blue);color:#fff;display:flex;align-items:center;justify-content:center}.card-grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.5),transparent 55%);pointer-events:none}.card-body{padding:.6rem}.card-title{font-size:.68rem;font-weight:800;color:#f1f5f9;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.2em}.card-sub{font-size:.6rem;color:#64748b;font-weight:700}
.sec-head{display:flex;align-items:center;gap:.55rem;margin:1.3rem .9rem .8rem}.sec-bar{width:4px;height:20px;border-radius:99px;background:linear-gradient(#3b82f6,#60a5fa)}.sec-ico{color:var(--blue);font-size:.75rem}.sec-title{font-size:.78rem;font-weight:900;color:#fff;text-transform:uppercase}.sec-count{font-size:.6rem;font-weight:900;background:rgba(59,130,246,.15);color:var(--blue);padding:.15rem .5rem;border-radius:99px}.sec-more{font-size:.62rem;font-weight:800;color:#94a3b8}
.row-scroll{display:flex;gap:.8rem;overflow-x:auto;padding:.1rem .9rem .4rem;scroll-snap-type:x mandatory;scrollbar-width:none}.row-scroll::-webkit-scrollbar{display:none}.row-item{width:128px;flex-shrink:0}@media(min-width:768px){.row-item{width:150px}}
.panel{background:var(--card);border:1px solid rgba(255,255,255,.06);border-radius:1.1rem}.top-bar{display:flex;align-items:center;gap:.6rem;padding:.9rem}.top-title{font-size:.82rem;font-weight:900;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.top-sub{font-size:.62rem;color:#64748b}.icon-btn2{width:2.3rem;height:2.3rem;border-radius:.75rem;background:var(--card);border:1px solid #374151;color:#cbd5e1;display:flex;align-items:center;justify-content:center;flex-shrink:0}.mini-head{font-size:.62rem;font-weight:900;color:#94a3b8;text-transform:uppercase;margin-bottom:.6rem}.srv-btn{font-size:.66rem;font-weight:800;background:#0f1117;border:1px solid var(--border);color:#cbd5e1;padding:.5rem .8rem;border-radius:.7rem}.srv-btn.on{background:linear-gradient(135deg,var(--blue),#2563eb);color:#fff;border-color:transparent}.chip-blue{font-size:.58rem;font-weight:900;background:rgba(59,130,246,.15);color:var(--blue);padding:.25rem .6rem;border-radius:99px}.genre-chip{font-size:.58rem;font-weight:800;background:rgba(59,130,246,.12);color:#93c5fd;border:1px solid rgba(59,130,246,.25);padding:.25rem .6rem;border-radius:99px}.ep-cell{background:#0f1117;border:1px solid var(--border);border-radius:.8rem;padding:.6rem;text-align:left}.dl-row{background:#0f1117;border:1px solid var(--border);border-radius:.7rem;padding:.55rem .65rem}.dl-link{font-size:.6rem;font-weight:800;background:rgba(59,130,246,.12);color:#93c5fd;padding:.3rem .6rem;border-radius:.55rem}.btn-primary{background:linear-gradient(135deg,var(--blue),#2563eb);color:#fff}.inline-spinner{width:20px;height:20px;border:2px solid rgba(59,130,246,.2);border-top-color:var(--blue);border-radius:50%;animation:spin .8s linear infinite;display:inline-block}@keyframes spin{to{transform:rotate(360deg)}}.btn-sort-flip i{transition:.5s;display:inline-block}.btn-sort-flip.is-flipped i{transform:scaleY(-1)}
.side-overlay{position:fixed;inset:0;z-index:80;background:#000000b3}.side-panel{position:fixed;top:0;right:0;bottom:0;width:100%;max-width:380px;background:#0f1117;z-index:90;border-left:1px solid var(--border);display:flex;flex-direction:column;transform:translateX(100%);transition:.4s}.side-panel.open{transform:translateX(0)}.day-chip{font-size:.62rem;font-weight:900;padding:.5rem .7rem;border-radius:.7rem;border:1px solid var(--border);background:var(--card);color:#94a3b8;flex-shrink:0}.day-chip.on{background:var(--blue);color:#fff}.hist-row{display:flex;gap:.6rem;padding:.6rem;border:1px solid var(--border);border-radius:.8rem;background:var(--card)}
.bottom-nav{position:sticky;bottom:0;z-index:40;background:#161922e6;backdrop-filter:blur(15px);border-top:1px solid var(--border);display:flex;padding:.55rem .4rem}.bnav{flex:1;display:flex;flex-direction:column;align-items:center;font-size:.56rem;font-weight:900;color:#64748b;text-transform:uppercase;padding:.35rem}.bnav i{font-size:.95rem}.bnav.on{color:var(--blue)}
.skel{background:linear-gradient(90deg,#161922,#1f2535,#161922);background-size:200% 100%;animation:sh 1.2s infinite;border-radius:.8rem}@keyframes sh{to{background-position:-200% 0}}
      `}</style>
      {!splash ? null : <div className="pur-splash"><div className="wave-wrap"><div className="wave-txt">PURTV</div><div className="wave-sub">NONTON DONGHUA & ANIME</div></div></div>}
      <div className="purtv-head">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-white text-sm flex-shrink-0" style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}>P</div>
          <div className="flex-1 min-w-0"><div className="logo">PUR<b>TV</b></div><div className="text-[9px] text-gray-500 font-bold tracking-widest uppercase -mt-0.5">Nonton Donghua & Anime</div></div>
          <button onClick={openSch} className="hbtn"><i className="fas fa-calendar-day text-sm" /></button>
          <button onClick={() => setShowHis(true)} className="hbtn"><i className="fas fa-history text-sm" /></button>
        </div>
        <form onSubmit={doSearch} className="relative mt-2.5">
          <input value={input} onChange={e => onInput(e.target.value)} onFocus={() => suggest.length && setShowSg(true)} placeholder="Cari anime / donghua..." className="search-input pl-9 pr-9" />
          <i className="fas fa-search absolute left-3.5 top-3 text-gray-500 text-xs" />
          {input && <button type="button" onClick={() => { setInput(''); setSuggest([]); setShowSg(false); }} className="absolute right-3 top-2.5 text-gray-500"><i className="fas fa-times text-xs" /></button>}
          {showSg && suggest.length > 0 && <div className="suggest">{suggest.map((s, i) => <button key={i} type="button" onClick={() => clickCard(s)}><span className="relative w-9 h-12 rounded-lg overflow-hidden bg-black flex-shrink-0">{s.thumbnail && <Image src={s.thumbnail} alt="" fill sizes="36px" className="object-cover" unoptimized />}</span><span className="flex-1 min-w-0"><span className="block text-[11px] font-bold text-white truncate">{asString(s.title)}</span><span className="block text-[9px] text-gray-500 font-bold">{asString(s.episode || s.type || '')}</span></span><i className="fas fa-chevron-right text-[10px] text-gray-600" /></button>)}<button type="submit" className="!py-2.5 justify-center text-[11px] font-black text-blue-400 border-t border-white/5">Lihat semua</button></div>}
        </form>
      </div>
      {view !== 'episode' && view !== 'series' && (
        <div className="tabs">{[['home', 'Beranda', 'fa-home'], ['anime', 'Anime', 'fa-dragon'], ['donghua', 'Donghua', 'fa-fire']].map(([t, l, ic]) => <button key={t} onClick={() => chTab(t)} className={'tab' + (tab === t ? ' on' : '')}><i className={'fas ' + ic + ' mr-1.5'} />{l}</button>)}<button onClick={openSch} className="tab"><i className="fas fa-calendar-day mr-1.5" />Jadwal</button><button onClick={() => setShowHis(true)} className="tab"><i className="fas fa-history mr-1.5" />Riwayat{his.length ? ' (' + his.length + ')' : ''}</button></div>
      )}
      {view !== 'episode' && view !== 'series' && allG.length > 0 && (
        <div className="tabs !pt-0">{allG.slice(0, 14).map((g, i) => { const slug = typeof g === 'string' ? g : g.slug || g.name; const label = typeof g === 'string' ? g : g.name || g.slug; return <button key={i} onClick={() => { setGenre(slug); setTab('genre'); setView('list'); }} className={'tab' + (genre === slug ? ' on' : '')}>{label}</button>; })}</div>
      )}
      <div className="pb-3 min-h-[50vh]">
        {view === 'episode' && selE ? <EpisodeView episode={selE} onBack={goBack} onOpenSeries={openSe} onOpenEpisode={openEp} onWatched={onWatched} />
        : view === 'series' && selS ? <SeriesView series={selS} onBack={goBack} onOpenEpisode={openEp} />
        : view === 'home' && tab === 'home' ? (
          <div className="anim-in">
            {loading && <div className="px-3.5 pt-2 space-y-3"><div className="skel h-52" /><div className="grid grid-cols-2 gap-3">{[0,1,2,3,4,5].map(i => <div key={i} className="skel aspect-[2/3]" />)}</div></div>}
            {err && !loading && <div className="mx-3.5 panel p-6 text-center"><p className="text-xs text-gray-300 mb-3">{err}</p><button onClick={loadHome} className="btn-primary text-xs font-bold px-4 py-2 rounded-xl">Coba Lagi</button></div>}
            {!loading && !err && home && (
              <>
                <Hero items={featured} onClick={clickCard} />
                <Sec icon="fa-clock" title="Episode Terbaru" count={latest.length} onMore={() => chTab('donghua')} /><Row items={latest.slice(0, 12)} onClick={clickCard} />
                <Sec icon="fa-dragon" title="Anime Terbaru" count={animeL.length} onMore={() => chTab('anime')} />{animeL.length ? <Row items={animeL.slice(0, 12)} onClick={clickCard} /> : <p className="text-[11px] text-gray-500 px-3.5">Belum ada data.</p>}
                <Sec icon="fa-fire" title="Donghua Terbaru" count={latest.length} onMore={() => chTab('donghua')} /><div className="grid-r">{latest.slice(0, 10).map((it, i) => <Card key={i} item={it} onClick={clickCard} />)}</div>
                <Sec icon="fa-calendar" title="Ongoing" count={ongoing.length} />{ongoing.length ? <Row items={ongoing.slice(0, 12)} onClick={clickCard} /> : null}
                <Sec icon="fa-star" title="Populer" count={popular.length || animeP.length} /><div className="grid-r">{(popular.length ? popular : animeP).slice(0, 10).map((it, i) => <Card key={i} item={it} onClick={clickCard} />)}</div>
                {recG.length > 0 && (<><Sec icon="fa-th-large" title="Rekomendasi Genre" count={recG.length} /><div className="tabs !pt-0">{recG.slice(0, 8).map((g, i) => <button key={i} onClick={() => setRecT(i)} className={'tab' + (recT === i ? ' on' : '')}>{g.name}</button>)}</div><div className="grid-r">{asArray(recI[recT]?.list || recI[0]?.list).slice(0, 10).map((it, i) => <Card key={i} item={it} onClick={clickCard} />)}</div></>)}
              </>
            )}
          </div>
        ) : (
          <div className="anim-in">
            <div className="px-3.5 pt-1"><h2 className="text-sm font-black text-white">{tab === 'search' ? 'Hasil: ' + search : genre ? asString(genre).replace(/-/g, ' ') : tab === 'anime' ? 'Anime' : tab === 'donghua' ? 'Donghua' : 'Daftar'}</h2><p className="text-[10px] text-gray-500 font-bold">{items.length} hasil</p></div>
            {loading && <div className="grid-r mt-3">{[0,1,2,3,4,5].map(i => <div key={i} className="skel aspect-[2/3]" />)}</div>}
            {err && !loading && <div className="mx-3.5 mt-3 panel p-6 text-center"><p className="text-xs text-gray-300 mb-3">{err}</p><button onClick={() => loadList(tab, genre, search)} className="btn-primary text-xs font-bold px-4 py-2 rounded-xl">Coba Lagi</button></div>}
            {!loading && !err && items.length > 0 && <div className="grid-r mt-3">{items.map((it, i) => <Card key={i} item={it} onClick={clickCard} />)}</div>}
            {!loading && !err && list && items.length === 0 && <div className="mx-3.5 mt-3 panel p-8 text-center"><i className="fas fa-film text-2xl text-gray-600 mb-3 block" /><p className="text-xs text-gray-500">Tidak ada hasil.</p></div>}
          </div>
        )}
      </div>
      {view !== 'episode' && view !== 'series' && (
        <div className="bottom-nav">{[['home', 'Home', 'fa-home'], ['anime', 'Anime', 'fa-dragon'], ['donghua', 'Donghua', 'fa-fire']].map(([t, l, ic]) => <button key={t} onClick={() => chTab(t)} className={'bnav' + (tab === t ? ' on' : '')}><i className={'fas ' + ic} />{l}</button>)}<button onClick={openSch} className="bnav"><i className="fas fa-calendar-day" />Jadwal</button><button onClick={() => setShowHis(true)} className="bnav"><i className="fas fa-history" />Riwayat</button></div>
      )}
      {showSch && (<><div className="side-overlay" onClick={() => setShowSch(false)} /><div className={'side-panel' + (showSch ? ' open' : '')}><div className="p-4 border-b border-white/5 flex items-center gap-3"><span className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#3b82f6,#2563eb)' }}><i className="fas fa-calendar-day text-sm" /></span><div className="flex-1"><h3 className="text-sm font-black text-white">Jadwal Rilis</h3><p className="text-[10px] text-gray-500">Donghua per hari</p></div><button onClick={() => setShowSch(false)} className="icon-btn2"><i className="fas fa-times" /></button></div><div className="p-3 flex gap-2 overflow-x-auto border-b border-white/5">{days.map((dd, i) => <button key={i} onClick={() => setDay(i)} className={'day-chip' + (day === i ? ' on' : '')}>{asString(dd.day || 'Hari ' + (i + 1)).slice(0, 10)}</button>)}{!days.length && <span className="text-[11px] text-gray-500">Memuat...</span>}</div><div className="flex-1 overflow-y-auto p-3 space-y-2">{asArray(curD?.list).map((it, i) => <button key={i} onClick={() => { setShowSch(false); clickCard(it); }} className="hist-row w-full text-left"><span className="relative w-11 h-16 rounded-lg overflow-hidden bg-black flex-shrink-0">{it.thumbnail && <Image src={it.thumbnail} alt="" fill sizes="44px" className="object-cover" unoptimized />}</span><span className="flex-1 min-w-0"><span className="block text-[11px] font-bold text-white truncate">{asString(it.title)}</span><span className="block text-[10px] text-blue-400 font-bold mt-0.5">{asString(it.releaseTime || it.nextEpisode || '')}</span></span></button>)}</div></div></>)}
      {showHis && (<><div className="side-overlay" onClick={() => setShowHis(false)} /><div className={'side-panel' + (showHis ? ' open' : '')}><div className="p-4 border-b border-white/5 flex items-center gap-3"><span className="w-9 h-9 rounded-xl flex items-center justify-center text-white" style={{ background: 'linear-gradient(135deg,#3b82f6,#8b5cf6)' }}><i className="fas fa-history text-sm" /></span><div className="flex-1"><h3 className="text-sm font-black text-white">Riwayat Nonton</h3><p className="text-[10px] text-gray-500">{his.length} tontonan • lokal</p></div><button onClick={() => setShowHis(false)} className="icon-btn2"><i className="fas fa-times" /></button></div><div className="flex-1 overflow-y-auto p-3 space-y-2">{!his.length && <div className="text-center py-10"><i className="fas fa-history text-3xl text-gray-700 mb-3 block" /><p className="text-[11px] text-gray-500">Belum ada riwayat.</p></div>}{his.map((h, i) => <div key={i} className="hist-row"><button onClick={() => { setShowHis(false); openEp({ url: h.url, title: h.episodeTitle }); }} className="flex gap-2.5 flex-1 min-w-0 text-left"><span className="relative w-11 h-16 rounded-lg overflow-hidden bg-black flex-shrink-0">{h.thumbnail && <Image src={h.thumbnail} alt="" fill sizes="44px" className="object-cover" unoptimized />}</span><span className="flex-1 min-w-0"><span className="block text-[11px] font-bold text-white truncate">{asString(h.seriesTitle || h.episodeTitle)}</span><span className="block text-[10px] text-gray-400 truncate">{asString(h.episodeTitle)}</span></span></button><button onClick={() => { const nh = his.filter(x => x.url !== h.url); const nt = [{ ...h, deletedAt: new Date().toISOString() }, ...trash].slice(0, 100); setHis(nh); setTrash(nt); saveHT(nh, nt); }} className="text-gray-600 px-1"><i className="fas fa-trash text-xs" /></button></div>)}</div></div></>)}
    </div>
  );
}
