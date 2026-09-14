'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';
import Link from 'next/link';

/* ============================================================
   PurTV — Nonton Donghua & Anime (anichin.cafe + samehadaku)
   Data: /api/purtv/* (home, list, genres, schedule, search,
         series, detail)
   ============================================================ */

const API = '/api/purtv';

const isSeriesUrl = (url = '') => /\/seri\/|\/anime\//.test(url);

async function fetchJson(path) {
  const res = await fetch(path);
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`Respons tidak valid (HTTP ${res.status})`);
  }
  if (!json.success) throw new Error(json.error || `Gagal memuat data (HTTP ${res.status})`);
  return json;
}

/* ---------- Skeleton ---------- */
const CardSkeleton = () => (
  <div className="native-card overflow-hidden animate-pulse flex flex-col h-full">
    <div className="relative w-full aspect-[3/4] bg-input flex-shrink-0"></div>
    <div className="p-3 space-y-2 flex-1">
      <div className="h-3 bg-input rounded w-3/4"></div>
      <div className="h-2.5 bg-input rounded w-1/2"></div>
    </div>
  </div>
);

const SkeletonGrid = ({ count = 6 }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
    {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
  </div>
);

/* ---------- Media Card ---------- */
const MediaCard = ({ item, onClick, showType = false }) => {
  const title = item.title || '';
  const episode = item.episode || '';
  const type = item.type || '';
  const source = item.source || '';
  const rating = item.rating || '';
  const rank = item.rank || '';

  return (
    <button
      onClick={() => onClick(item)}
      className="native-card overflow-hidden text-left group hover:border-accent/40 transition-all active:scale-95 flex flex-col h-full min-w-0"
    >
      <div className="relative w-full aspect-[3/4] bg-input overflow-hidden flex-shrink-0">
        {item.thumbnail ? (
          <Image
            src={item.thumbnail}
            alt={title}
            fill
            sizes="(max-width: 768px) 45vw, 25vw"
            className="object-cover w-full h-full group-hover:scale-105 transition-transform duration-500"
            unoptimized
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted">
            <i className="fas fa-film text-2xl"></i>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>

        {rank && (
          <span className="absolute top-2 left-2 text-[9px] font-black bg-gradient-to-r from-amber-400 to-orange-500 text-black px-2 py-0.5 rounded-full shadow-lg">
            {rank}
          </span>
        )}
        {source === 'samehadaku' && (
          <span className="absolute top-2 right-2 text-[8px] font-bold bg-blue-500/90 text-white px-1.5 py-0.5 rounded-full">
            Anime
          </span>
        )}
        {source === 'anichin' && (
          <span className="absolute top-2 right-2 text-[8px] font-bold bg-rose-500/90 text-white px-1.5 py-0.5 rounded-full">
            Donghua
          </span>
        )}

        <div className="absolute bottom-0 left-0 right-0 p-2">
          {episode && (
            <span className="text-[9px] font-bold bg-accent/95 text-white px-2 py-0.5 rounded-full shadow">
              {episode}
            </span>
          )}
          {type && showType && (
            <span className="text-[9px] font-bold bg-white/20 backdrop-blur text-white px-2 py-0.5 rounded-full ml-1">
              {type}
            </span>
          )}
        </div>
      </div>
      <div className="p-2.5 flex-1 flex flex-col min-w-0">
        <div className="text-[11px] font-bold text-primary leading-snug line-clamp-2 group-hover:text-accent transition-colors min-h-[32px]">
          {title}
        </div>
        {rating && (
          <div className="mt-1 flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
            <i className="fas fa-star text-[8px]"></i> {rating}
          </div>
        )}
      </div>
    </button>
  );
};

/* ---------- Section Row ---------- */
const SectionRow = ({ title, icon, items, onClick, horizontal = true }) => {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-6">
      <h3 className="text-sm font-bold text-primary mb-3 px-1 flex items-center gap-2">
        <i className={`fas ${icon} text-accent text-xs`}></i>
        <span className="uppercase tracking-wider text-[12px]">{title}</span>
        <span className="text-[10px] text-muted font-semibold">{items.length}</span>
      </h3>
      {horizontal ? (
        <div className="flex gap-3 overflow-x-auto custom-scrollbar snap-x snap-mandatory pb-2 -mx-1 px-1">
          {items.map((item, i) => (
            <div key={i} className="w-[130px] md:w-[150px] flex-shrink-0 snap-start">
              <MediaCard item={item} onClick={onClick} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
          {items.map((item, i) => (
            <MediaCard key={i} item={item} onClick={onClick} showType />
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------- Featured Slider ---------- */
const FeaturedSlider = ({ items, onClick }) => {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-6">
      <div className="flex gap-3 overflow-x-auto custom-scrollbar snap-x snap-mandatory pb-2 -mx-1 px-1">
        {items.map((item, i) => (
          <button
            key={i}
            onClick={() => onClick(item)}
            className="relative w-[240px] md:w-[320px] flex-shrink-0 snap-start rounded-2xl overflow-hidden native-card group text-left"
          >
            <div className="relative aspect-video bg-input">
              {item.thumbnail && (
                <Image
                  src={item.thumbnail}
                  alt={item.title || 'Featured'}
                  fill
                  sizes="(max-width: 768px) 60vw, 30vw"
                  className="object-cover group-hover:scale-105 transition-transform duration-700"
                  unoptimized
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent"></div>
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <span className="text-[8px] font-bold bg-accent text-white px-2 py-0.5 rounded-full uppercase tracking-widest mb-1.5 inline-block">
                  <i className="fas fa-play mr-1"></i> Unggulan
                </span>
                <div className="text-[13px] font-bold text-white leading-snug line-clamp-2">{item.title}</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

/* ---------- Player / Episode Detail ---------- */
const EpisodeView = ({ episode, onBack, onOpenSeries, onOpenEpisode }) => {
  const [detail, setDetail] = useState(null);
  const [seriesSynopsis, setSeriesSynopsis] = useState(null);
  const [seriesPoster, setSeriesPoster] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [playerSrc, setPlayerSrc] = useState(null);
  const [playerLoading, setPlayerLoading] = useState(false);
  const [activeServer, setActiveServer] = useState(null);
  const [playerError, setPlayerError] = useState(null);

  const resolvePlayer = useCallback(async (server, slug) => {
    if (!server?.post || !server?.nume) return;
    setPlayerLoading(true);
    setPlayerError(null);
    setActiveServer(server);
    try {
      const qs = new URLSearchParams({ post: server.post, nume: server.nume, type: server.type || 'schtml', slug: slug || '' });
      const r = await fetch(`${API}/player?${qs.toString()}`);
      const j = await r.json();
      if (j.success && j.iframe) setPlayerSrc(j.iframe);
      else throw new Error(j.error || 'Gagal memuat player');
    } catch (e) {
      console.error('player error', e);
      setPlayerError(e.message || 'Gagal memuat player');
    } finally {
      setPlayerLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    setSeriesPoster(null);
    setPlayerSrc(null);
    setActiveServer(null);
    setPlayerError(null);
    fetchJson(`${API}/detail?url=${encodeURIComponent(episode.url)}`)
      .then((d) => {
        if (active) {
          setDetail(d);
          if (d.defaultIframe) {
            setPlayerSrc(d.defaultIframe);
          } else if (d.episodeSlug && d.streamingLinks && d.streamingLinks.length > 0) {
            const first = d.streamingLinks.find((x) => x.post && x.nume) || d.streamingLinks[0];
            if (first?.post) resolvePlayer(first, d.episodeSlug);
          }
          if (d.seriesUrl && (!d.thumbnail || !d.synopsis)) {
            fetchJson(`${API}/series?url=${encodeURIComponent(d.seriesUrl)}`)
              .then((sd) => { if (active) { if (!d.synopsis) setSeriesSynopsis(sd.synopsis || null); if (!d.thumbnail) setSeriesPoster(sd.poster || null); } })
              .catch(() => {});
          }
        }
      })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [episode.url, resolvePlayer]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-input border border-default text-secondary hover:text-white flex items-center justify-center active:scale-90 transition-all">
          <i className="fas fa-arrow-left text-sm"></i>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-primary truncate">{episode.title}</h2>
          <span className="text-[10px] text-muted">Detail Episode</span>
        </div>
      </div>

      {(detail && !loading && (detail.thumbnail || seriesPoster)) && (
        <div className="native-card overflow-hidden mb-4">
          <div className="flex gap-3 p-3">
            <div className="relative w-24 h-32 rounded-xl overflow-hidden bg-input flex-shrink-0">
              <Image
                src={detail.thumbnail || seriesPoster}
                alt={detail.title || episode.title}
                fill
                sizes="96px"
                className="object-cover"
                unoptimized
              />
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-center">
              <h3 className="text-sm font-bold text-primary leading-snug mb-1">{detail.title || episode.title}</h3>
              {detail.series && (
                <div className="text-[11px] text-accent font-semibold truncate mb-1">
                  <i className="fas fa-tv text-[9px] mr-1"></i>{detail.series}
                </div>
              )}
              {detail.episode && (
                <span className="text-[9px] font-bold bg-accent/15 text-accent px-2 py-0.5 rounded-full self-start">
                  Episode {detail.episode}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {(detail && !loading && (detail.synopsis || seriesSynopsis)) && (
        <div className="native-card p-4 mb-4">
          <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2 flex items-center gap-2">
            <i className="fas fa-align-left text-accent text-[9px]"></i> Sinopsis
          </h4>
          <p className="text-xs text-secondary leading-relaxed">{detail.synopsis || seriesSynopsis}</p>
        </div>
      )}

      {loading && (
        <div className="native-card p-8 flex flex-col items-center gap-3 animate-pulse">
          <div className="w-12 h-12 rounded-2xl bg-input flex items-center justify-center">
            <i className="fas fa-spinner fa-spin text-accent text-lg"></i>
          </div>
          <p className="text-xs text-muted">Memuat player...</p>
        </div>
      )}

      {error && (
        <div className="native-card p-6 text-center">
          <i className="fas fa-exclamation-triangle text-amber-400 text-2xl mb-2 block"></i>
          <p className="text-xs text-secondary mb-3">{error}</p>
          <button onClick={() => window.location.reload()} className="text-xs bg-accent text-white font-bold px-4 py-2 rounded-xl">
            Coba Lagi
          </button>
        </div>
      )}

      {detail && !loading && (
        <>
          {(playerSrc || detail.defaultIframe || playerLoading || playerError || (detail.streamingLinks || []).some((x) => x.post && x.nume)) && (
            <div className="native-card overflow-hidden mb-4">
              <div className="relative w-full aspect-video bg-black">
                {playerLoading && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
                    <i className="fas fa-spinner fa-spin text-accent text-xl"></i>
                  </div>
                )}
                {(playerSrc || detail.defaultIframe) ? (
                  <iframe
                    key={playerSrc || detail.defaultIframe}
                    src={playerSrc || detail.defaultIframe}
                    title={episode.title}
                    className="absolute inset-0 w-full h-full"
                    allowFullScreen
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                    referrerPolicy="no-referrer"
                  />
                ) : !playerLoading && playerError ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center">
                    <i className="fas fa-exclamation-triangle text-amber-400 text-xl"></i>
                    <p className="text-[11px] text-secondary">{playerError}</p>
                    <button
                      onClick={() => {
                        const srv = activeServer || (detail.streamingLinks || []).find((x) => x.post && x.nume);
                        if (srv) resolvePlayer(srv, detail.episodeSlug);
                      }}
                      className="text-[11px] bg-accent text-white font-bold px-4 py-2 rounded-xl"
                    >
                      Coba Lagi
                    </button>
                  </div>
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted text-xs">
                    Player tidak tersedia
                  </div>
                )}
              </div>
            </div>
          )}

          {(detail.episodes || []).length > 0 && (
            <div className="native-card p-4 mb-4">
              <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-3 flex items-center gap-2">
                <i className="fas fa-list-ol text-accent text-[9px]"></i> Episode
              </h4>
              <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                {detail.episodes.map((ep, i) => (
                  <button key={i} onClick={() => onOpenEpisode(ep)} className="text-[10px] font-bold bg-input border border-default rounded-lg py-2 px-1 text-secondary hover:text-primary hover:border-accent/50 transition-colors">
                    {ep.episode || ep.title || `Ep ${i + 1}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {detail.seriesUrl && (
            <button onClick={() => onOpenSeries(detail.seriesUrl, detail.series || episode.title)} className="w-full native-card p-4 flex items-center justify-center gap-2 text-accent hover:border-accent/40 transition-all active:scale-95 mb-4">
              <i className="fas fa-tv"></i> Buka Halaman Series
            </button>
          )}
        </>
      )}
    </div>
  );
};

/* ---------- Series View ---------- */
const SeriesView = ({ series, onBack, onOpenEpisode }) => {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetchJson(`${API}/series?url=${encodeURIComponent(series.url)}`)
      .then((d) => { if (active) setDetail(d); })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [series.url]);

  if (loading) {
    return (
      <div className="animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="w-9 h-9 rounded-xl bg-input border border-default text-secondary flex items-center justify-center"><i className="fas fa-arrow-left text-sm"></i></button>
          <h2 className="text-sm font-bold text-primary truncate">{series.title}</h2>
        </div>
        <div className="native-card p-4 animate-pulse">
          <div className="h-40 bg-input rounded-xl mb-4"></div>
          <div className="h-4 bg-input rounded w-2/3 mb-2"></div>
          <div className="h-3 bg-input rounded w-full mb-2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="native-card p-6 text-center">
        <i className="fas fa-exclamation-triangle text-amber-400 text-2xl mb-2 block"></i>
        <p className="text-xs text-secondary mb-3">{error}</p>
        <button onClick={onBack} className="text-xs bg-accent text-white font-bold px-4 py-2 rounded-xl">Kembali</button>
      </div>
    );
  }

  const poster = detail?.poster || detail?.thumbnail || series.thumbnail;
  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-input border border-default text-secondary hover:text-white flex items-center justify-center active:scale-90 transition-all"><i className="fas fa-arrow-left text-sm"></i></button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-primary truncate">{detail?.title || series.title}</h2>
          <span className="text-[10px] text-muted">Detail Series</span>
        </div>
      </div>

      <div className="native-card overflow-hidden mb-4">
        <div className="flex gap-4 p-4">
          {poster && (
            <div className="relative w-28 h-40 rounded-xl overflow-hidden bg-input flex-shrink-0">
              <Image src={poster} alt={detail?.title || series.title} fill sizes="112px" className="object-cover" unoptimized />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-bold text-primary leading-snug mb-2">{detail?.title || series.title}</h3>
            {detail?.genres && <div className="text-[10px] text-accent font-semibold mb-2">{Array.isArray(detail.genres) ? detail.genres.join(' • ') : detail.genres}</div>}
            {detail?.synopsis && <p className="text-[11px] text-secondary leading-relaxed line-clamp-6">{detail.synopsis}</p>}
          </div>
        </div>
      </div>

      {(detail?.episodes || []).length > 0 && (
        <div className="mb-6">
          <h3 className="text-sm font-bold text-primary mb-3 px-1 flex items-center gap-2">
            <i className="fas fa-list-ol text-accent text-xs"></i>
            <span className="uppercase tracking-wider text-[12px]">Daftar Episode</span>
            <span className="text-[10px] text-muted font-semibold">{detail.episodes.length}</span>
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
            {detail.episodes.map((ep, i) => (
              <button key={i} onClick={() => onOpenEpisode(ep)} className="native-card p-3 text-left hover:border-accent/40 transition-all active:scale-95 min-w-0">
                <div className="text-[11px] font-bold text-primary line-clamp-2">{ep.title || ep.episode || `Episode ${i + 1}`}</div>
                {ep.episode && <div className="text-[9px] text-muted mt-1">Episode {ep.episode}</div>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ---------- Main Page ---------- */
export default function PurTVPage() {
  const [view, setView] = useState('home');
  const [home, setHome] = useState(null);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [activeGenre, setActiveGenre] = useState(null);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [selectedSeries, setSelectedSeries] = useState(null);
  const [selectedEpisode, setSelectedEpisode] = useState(null);
  const scrollRef = useRef(null);

  const loadHome = useCallback(async () => {
    setLoading(true); setError(null);
    try { setHome(await fetchJson(`${API}/home`)); } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, []);

  const loadList = useCallback(async (type = activeTab, genre = activeGenre, query = search) => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams();
      if (type && type !== 'home') params.set('type', type);
      if (genre) params.set('genre', genre);
      if (query) params.set('q', query);
      setList(await fetchJson(`${API}/list?${params.toString()}`));
    } catch (e) { setError(e.message); } finally { setLoading(false); }
  }, [activeTab, activeGenre, search]);

  useEffect(() => { loadHome(); }, [loadHome]);

  useEffect(() => {
    if (activeTab !== 'home') loadList(activeTab, activeGenre, search);
  }, [activeTab, activeGenre, search, loadList]);

  const openEpisode = (ep) => { setSelectedEpisode(ep); setView('episode'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const openSeries = (url, title, thumbnail = null) => { setSelectedSeries({ url, title, thumbnail }); setView('series'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const handleCardClick = (item) => {
    if (item.url && (isSeriesUrl(item.url) || item.isSeries)) openSeries(item.url, item.title, item.thumbnail);
    else openEpisode(item);
  };

  const doSearch = (e) => {
    e?.preventDefault();
    setSearch(searchInput.trim());
    setActiveTab('search');
    setActiveGenre(null);
  };

  const changeTab = (tab) => {
    setActiveTab(tab); setActiveGenre(null); setSearch(''); setSearchInput('');
    if (tab === 'home') setView('home');
    else setView('list');
  };

  const handleGenre = (genre) => { setActiveGenre(genre); setActiveTab('genre'); setSearch(''); setSearchInput(''); setView('list'); };

  const goBack = () => { setView('home'); setSelectedSeries(null); setSelectedEpisode(null); };

  return (
    <main className="max-w-5xl mx-auto px-4 py-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-black text-primary flex items-center gap-2"><i className="fas fa-tv text-accent"></i> PurTV</h1>
          <p className="text-[11px] text-muted mt-1">Nonton Anime & Donghua</p>
        </div>
        <form onSubmit={doSearch} className="relative w-full md:w-80">
          <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Cari anime / donghua..." className="w-full bg-input border border-default rounded-xl pl-10 pr-10 py-2.5 text-xs text-primary outline-none focus:border-accent transition-colors" />
          <i className="fas fa-search absolute left-3.5 top-3 text-muted text-xs"></i>
          {searchInput && <button type="button" onClick={() => { setSearchInput(''); setSearch(''); }} className="absolute right-3 top-2.5 text-muted hover:text-primary"><i className="fas fa-times text-xs"></i></button>}
        </form>
      </div>

      <div className="flex gap-2 overflow-x-auto custom-scrollbar pb-2 mb-5">
        {[['home','Home','fa-home'],['anime','Anime','fa-dragon'],['donghua','Donghua','fa-film']].map(([tab,label,icon]) => (
          <button key={tab} onClick={() => changeTab(tab)} className={`flex-shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold border transition-all ${activeTab === tab ? 'bg-accent text-white border-accent' : 'bg-input text-secondary border-default hover:text-primary'}`}>
            <i className={`fas ${icon} mr-1.5`}></i>{label}
          </button>
        ))}
        {home?.genres && (
          <div className="flex gap-2">
            {home.genres.slice(0, 8).map((g, i) => (
              <button key={i} onClick={() => handleGenre(g)} className={`flex-shrink-0 px-3 py-2 rounded-xl text-[10px] font-bold border ${activeGenre === g ? 'bg-accent text-white border-accent' : 'bg-input text-secondary border-default'}`}>
                {g}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'episode' && selectedEpisode ? (
        <EpisodeView episode={selectedEpisode} onBack={goBack} onOpenSeries={openSeries} onOpenEpisode={openEpisode} />
      ) : view === 'series' && selectedSeries ? (
        <SeriesView series={selectedSeries} onBack={goBack} onOpenEpisode={openEpisode} />
      ) : (
        <>
          {view === 'home' && activeTab === 'home' && (
            <>
              {loading && <SkeletonGrid count={6} />}
              {error && !loading && <div className="native-card p-6 text-center"><p className="text-xs text-secondary mb-3">{error}</p><button onClick={loadHome} className="text-xs bg-accent text-white font-bold px-4 py-2 rounded-xl">Coba Lagi</button></div>}
              {!loading && !error && home && (
                <>
                  {home.featured && <FeaturedSlider items={home.featured} onClick={handleCardClick} />}
                  <SectionRow title="Episode Terbaru" icon="fa-clock" items={home.latest} onClick={handleCardClick} />
                  <SectionRow title="Anime Terbaru" icon="fa-dragon" items={home.anime} onClick={handleCardClick} />
                  <SectionRow title="Donghua Terbaru" icon="fa-film" items={home.donghua} onClick={handleCardClick} />
                  <SectionRow title="Populer" icon="fa-fire" items={home.popular} onClick={handleCardClick} />
                </>
              )}
            </>
          )}

          {view === 'list' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-base font-bold text-primary">{activeTab === 'search' ? `Hasil: ${search}` : activeGenre ? activeGenre : activeTab === 'anime' ? 'Anime' : activeTab === 'donghua' ? 'Donghua' : 'Daftar'}</h2>
                  <p className="text-[10px] text-muted">{list?.items?.length || 0} hasil</p>
                </div>
              </div>
              {loading && <SkeletonGrid count={9} />}
              {error && !loading && <div className="native-card p-6 text-center"><p className="text-xs text-secondary mb-3">{error}</p><button onClick={() => loadList(activeTab, activeGenre, search)} className="text-xs bg-accent text-white font-bold px-4 py-2 rounded-xl">Coba Lagi</button></div>}
              {!loading && !error && list?.items?.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
                  {list.items.map((item, i) => <MediaCard key={i} item={item} onClick={handleCardClick} showType />)}
                </div>
              )}
              {!loading && !error && list && (!list.items || list.items.length === 0) && (
                <div className="native-card p-8 text-center"><i className="fas fa-film text-2xl text-muted mb-3"></i><p className="text-xs text-muted">Tidak ada hasil.</p></div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
