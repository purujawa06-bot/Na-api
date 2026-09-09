'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Image from 'next/image';

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
  <div className="native-card overflow-hidden animate-pulse">
    <div className="w-full aspect-[3/4] bg-input"></div>
    <div className="p-3 space-y-2">
      <div className="h-3 bg-input rounded w-3/4"></div>
      <div className="h-2.5 bg-input rounded w-1/2"></div>
    </div>
  </div>
);

const SkeletonGrid = ({ count = 6 }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
      className="native-card overflow-hidden text-left group hover:border-accent/40 transition-all active:scale-95 flex flex-col h-full"
    >
      <div className="relative w-full aspect-[3/4] bg-input overflow-hidden flex-shrink-0">
        {item.thumbnail ? (
          <Image
            src={item.thumbnail}
            alt={title}
            fill
            sizes="(max-width: 768px) 45vw, 25vw"
            className="object-cover group-hover:scale-105 transition-transform duration-500"
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
      <div className="p-2.5 flex-1 flex flex-col">
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
    setPlayerSrc(null);
    setActiveServer(null);
    setPlayerError(null);
    fetchJson(`${API}/detail?url=${encodeURIComponent(episode.url)}`)
      .then((d) => {
        if (active) {
          setDetail(d);
          // Auto-load player: donghua uses defaultIframe, anime uses first server via /player
          if (d.defaultIframe) {
            setPlayerSrc(d.defaultIframe);
          } else if (d.episodeSlug && d.streamingLinks && d.streamingLinks.length > 0) {
            const first = d.streamingLinks.find((x) => x.post && x.nume) || d.streamingLinks[0];
            if (first?.post) resolvePlayer(first, d.episodeSlug);
          }
          if (!d.synopsis && d.seriesUrl) {
            fetchJson(`${API}/series?url=${encodeURIComponent(d.seriesUrl)}`)
              .then((sd) => { if (active) setSeriesSynopsis(sd.synopsis || null); })
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


      {/* Sinopsis (anime/donghua) */}
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
          {/* Player */}
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
                      className="text-[11px] bg-accent text-white font-bold px-4 py-2 rounded-xl active:scale-95 transition-all"
                    >
                      <i className="fas fa-redo mr-1"></i> Coba Lagi
                    </button>
                  </div>
                ) : null}
              </div>
              <div className="p-3 flex items-center justify-between gap-2">
                <span className="text-[10px] text-muted font-semibold uppercase tracking-wider">
                  <i className="fas fa-tv mr-1 text-accent"></i> {activeServer ? activeServer.server || `Server ${activeServer.index}` : 'Player Default'}
                </span>
                {(playerSrc || detail.defaultIframe) && (
                  <a
                    href={playerSrc || detail.defaultIframe}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] bg-input border border-default text-secondary hover:text-white px-3 py-1.5 rounded-lg font-bold transition-colors"
                  >
                    <i className="fas fa-external-link-alt mr-1"></i> Buka di Tab Baru
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Streaming Links */}
          {detail.streamingLinks && detail.streamingLinks.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-primary mb-2 px-1 flex items-center gap-2 uppercase tracking-wider">
                <i className="fas fa-server text-accent text-[10px]"></i> Server Streaming
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {detail.streamingLinks.map((srv, i) => {
                  const isActive = activeServer && (activeServer.post === srv.post && activeServer.nume === srv.nume) || (!activeServer && i === 0 && !srv.url && srv.post);
                  const hasDirectUrl = !!srv.url;
                  const hasPlayer = !!srv.post && !!srv.nume;
                  return (
                    <button
                      key={i}
                      onClick={() => {
                        if (hasDirectUrl) { setPlayerSrc(srv.url); setActiveServer(srv); }
                        else if (hasPlayer) resolvePlayer(srv, detail.episodeSlug);
                        else window.open(episode.url, '_blank');
                      }}
                      className={`native-card p-3 flex items-center gap-2 transition-all active:scale-95 group text-left w-full ${isActive ? 'border-accent/60 bg-accent/5' : 'hover:border-accent/40'}`}
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110 ${isActive ? 'bg-accent text-white' : 'bg-accent/10 text-accent'}`}>
                        <i className="fas fa-play text-[10px]"></i>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[11px] font-bold text-primary truncate">{srv.server || `Server ${srv.index || i+1}`}</div>
                        <div className="text-[9px] text-muted">{hasDirectUrl ? 'Direct' : hasPlayer ? `#${srv.nume} ${srv.type || ''}`.trim() : 'Buka di tab baru'}</div>
                      </div>
                      {isActive && <i className="fas fa-check text-accent text-[10px]"></i>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Download Links */}
          {detail.downloadLinks && detail.downloadLinks.length > 0 && (
            <div className="mb-4">
              <h3 className="text-xs font-bold text-primary mb-2 px-1 flex items-center gap-2 uppercase tracking-wider">
                <i className="fas fa-download text-accent text-[10px]"></i> Download
              </h3>
              <div className="space-y-2">
                {detail.downloadLinks.map((d, i) => {
                  const links = d.links && d.links.length ? d.links : (d.url ? [{ host: d.host || 'Link', url: d.url }] : []);
                  const label = d.title || d.quality || (d.links && d.links[0]?.quality) || `Link ${i + 1}`;
                  if (links.length === 0) return null;
                  return (
                    <div key={i} className="native-card p-3">
                      <div className="text-[11px] font-bold text-primary mb-2">{label}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {links.map((l, j) => (
                          <a
                            key={j}
                            href={l.url || l.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] bg-input border border-default text-secondary hover:text-white hover:border-accent/40 px-2.5 py-1 rounded-lg font-bold transition-colors"
                          >
                            <i className="fas fa-download text-[8px] mr-1"></i>{l.host || 'Download'}
                          </a>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Navigation */}
          {(detail.navigation?.next || detail.navigation?.prev) && (
            <div className="grid grid-cols-2 gap-2 mb-4">
              {detail.navigation.prev && (
                <button
                  onClick={() => onOpenEpisode({ url: detail.navigation.prev, title: episode.title })}
                  className="native-card p-3 text-left hover:border-accent/40 transition-all active:scale-95"
                >
                  <span className="text-[9px] text-muted uppercase tracking-wider block mb-1"><i className="fas fa-chevron-left mr-1"></i> Prev</span>
                  <span className="text-[10px] font-bold text-primary line-clamp-1">Episode sebelumnya</span>
                </button>
              )}
              {detail.navigation.next && (
                <button
                  onClick={() => onOpenEpisode({ url: detail.navigation.next, title: episode.title })}
                  className="native-card p-3 text-right hover:border-accent/40 transition-all active:scale-95"
                >
                  <span className="text-[9px] text-muted uppercase tracking-wider block mb-1">Next <i className="fas fa-chevron-right ml-1"></i></span>
                  <span className="text-[10px] font-bold text-primary line-clamp-1">Episode berikutnya</span>
                </button>
              )}
            </div>
          )}

          {detail.seriesUrl && (
            <button
              onClick={() => onOpenSeries(detail.seriesUrl, episode.title)}
              className="w-full native-card p-4 flex items-center justify-center gap-2 text-accent hover:border-accent/40 transition-all active:scale-95 mb-4"
            >
              <i className="fas fa-list-ul text-sm"></i>
              <span className="text-xs font-bold">Lihat Semua Episode</span>
            </button>
          )}
        </>
      )}
    </div>
  );
};

/* ---------- Series View (episodes) ---------- */
const SeriesView = ({ series, onBack, onOpenEpisode }) => {
  const [episodes, setEpisodes] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchJson(`${API}/series?url=${encodeURIComponent(series.url)}`)
      .then((d) => { if (active) { setDetail(d); setEpisodes(d.episodes || []); } })
      .catch((e) => { if (active) setError(e.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [series.url]);

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-3 mb-4">
        <button onClick={onBack} className="w-9 h-9 rounded-xl bg-input border border-default text-secondary hover:text-white flex items-center justify-center active:scale-90 transition-all">
          <i className="fas fa-arrow-left text-sm"></i>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-bold text-primary truncate">{series.title}</h2>
          <span className="text-[10px] text-muted">{episodes.length} episode</span>
        </div>
      </div>


      {/* Info + Sinopsis */}
      {detail && !loading && (
        <div className="mb-4">
          <div className="native-card overflow-hidden mb-3">
            <div className="flex gap-3 p-3">
              {detail.poster && (
                <div className="relative w-24 h-32 rounded-xl overflow-hidden bg-input flex-shrink-0">
                  <Image
                    src={detail.poster}
                    alt={detail.title || series.title}
                    fill
                    sizes="96px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-primary mb-1">{detail.title || series.title}</h3>
                {detail.rating && (
                  <div className="flex items-center gap-1 text-[11px] text-amber-400 font-semibold mb-1">
                    <i className="fas fa-star text-[9px]"></i> {detail.rating}
                  </div>
                )}
                {detail.genres && detail.genres.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {detail.genres.map((g, i) => (
                      <span key={i} className="text-[9px] bg-accent/10 text-accent px-2 py-0.5 rounded-full font-bold">
                        {typeof g === 'string' ? g : g.name}
                      </span>
                    ))}
                  </div>
                )}
                {detail.info && Object.entries(detail.info).length > 0 && (
                  <div className="space-y-0.5">
                    {Object.entries(detail.info).map(([k, v]) => (
                      <div key={k} className="text-[10px] text-muted">
                        <span className="text-secondary font-bold">{k}:</span> {v}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          {detail.synopsis && (
            <div className="native-card p-4 mb-3">
              <h4 className="text-[10px] font-bold text-muted uppercase tracking-wider mb-2 flex items-center gap-2">
                <i className="fas fa-align-left text-accent text-[9px]"></i> Sinopsis
              </h4>
              <p className="text-xs text-secondary leading-relaxed">{detail.synopsis}</p>
            </div>
          )}
        </div>
      )}


      {loading && (
        <div className="native-card p-8 flex flex-col items-center gap-3 animate-pulse">
          <div className="w-12 h-12 rounded-2xl bg-input flex items-center justify-center">
            <i className="fas fa-spinner fa-spin text-accent text-lg"></i>
          </div>
          <p className="text-xs text-muted">Memuat daftar episode...</p>
        </div>
      )}

      {error && (
        <div className="native-card p-6 text-center">
          <i className="fas fa-exclamation-triangle text-amber-400 text-2xl mb-2 block"></i>
          <p className="text-xs text-secondary mb-3">{error}</p>
          <button onClick={() => setError(null) || fetchJson(`${API}/series?url=${encodeURIComponent(series.url)}`).then(d => { setDetail(d); setEpisodes(d.episodes || []); }).catch(e => setError(e.message))} className="text-xs bg-accent text-white font-bold px-4 py-2 rounded-xl">
            Coba Lagi
          </button>
        </div>
      )}

      {!loading && !error && episodes.length === 0 && (
        <div className="native-card p-6 text-center">
          <i className="fas fa-film text-muted text-2xl mb-2 block"></i>
          <p className="text-xs text-muted">Tidak ada episode ditemukan.</p>
        </div>
      )}

      {!loading && episodes.length > 0 && (
        <div className="grid grid-cols-1 gap-2">
          {episodes.map((ep, i) => (
            <button
              key={i}
              onClick={() => onOpenEpisode(ep)}
              className="native-card p-3.5 flex items-center gap-3 hover:border-accent/40 transition-all active:scale-95 text-left group"
            >
              <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center text-accent flex-shrink-0 group-hover:scale-110 transition-transform">
                <i className="fas fa-play text-[10px]"></i>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-bold text-primary truncate">{ep.title}</div>
                {ep.episode && <div className="text-[10px] text-muted">Episode {ep.episode}</div>}
              </div>
              <i className="fas fa-chevron-right text-muted text-xs"></i>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

/* ---------- Main Page ---------- */
export default function PurTVPage() {
  const [tab, setTab] = useState('home'); // home | list | jadwal | genre
  const [homeData, setHomeData] = useState(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [homeError, setHomeError] = useState(null);

  // List state
  const [listGenre, setListGenre] = useState('');
  const [listSource, setListSource] = useState('semua'); // semua | anichin | samehadaku
  const [listPage, setListPage] = useState(1);
  const [listData, setListData] = useState(null);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);

  // Genre state
  const [genres, setGenres] = useState([]);
  const [genresLoading, setGenresLoading] = useState(true);

  // Schedule state
  const [schedule, setSchedule] = useState([]);
  const [scheduleLoading, setScheduleLoading] = useState(true);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [searchData, setSearchData] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  const [searchPage, setSearchPage] = useState(1);

  // Overlay: null | {type:'series',...} | {type:'episode',...}
  const [overlay, setOverlay] = useState(null);
  const scrollRef = useRef(null);

  /* ----- Load home ----- */
  const loadHome = useCallback(async () => {
    setHomeLoading(true);
    setHomeError(null);
    try {
      const d = await fetchJson(`${API}/home`);
      setHomeData(d);
    } catch (e) {
      setHomeError(e.message);
    } finally {
      setHomeLoading(false);
    }
  }, []);

  useEffect(() => { loadHome(); }, [loadHome]);

  /* ----- Load genres ----- */
  useEffect(() => {
    let active = true;
    fetchJson(`${API}/genres`)
      .then((d) => { if (active) setGenres(d.genres || []); })
      .catch(() => {})
      .finally(() => { if (active) setGenresLoading(false); });
    return () => { active = false; };
  }, []);

  /* ----- Load schedule ----- */
  useEffect(() => {
    let active = true;
    fetchJson(`${API}/schedule`)
      .then((d) => { if (active) setSchedule(d.schedule || []); })
      .catch(() => {})
      .finally(() => { if (active) setScheduleLoading(false); });
    return () => { active = false; };
  }, []);

  /* ----- Load list (tab / genre / page) ----- */
  useEffect(() => {
    if (tab !== 'list') return;
    let active = true;
    setListLoading(true);
    setListError(null);
    const params = new URLSearchParams();
    if (listGenre) params.set('genre', listGenre);
    params.set('page', String(listPage));
    fetchJson(`${API}/list?${params.toString()}`)
      .then((d) => { if (active) setListData(d); })
      .catch((e) => { if (active) setListError(e.message); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [tab, listGenre, listPage]);

  /* ----- Search ----- */
  const runSearch = useCallback(async (q, page = 1) => {
    if (!q.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setTab('home'); // search is an overlay-like view handled via searchData
    try {
      const d = await fetchJson(`${API}/search?q=${encodeURIComponent(q.trim())}&page=${page}`);
      setSearchData(d);
      setSearchPage(page);
    } catch (e) {
      setSearchError(e.message);
      setSearchData(null);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    if (!searchInput.trim()) return;
    setSearchQuery(searchInput.trim());
    runSearch(searchInput, 1);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  /* ----- Click handlers ----- */
  const handleOpenItem = (item) => {
    if (!item?.url) return;
    setOverlay({ type: isSeriesUrl(item.url) ? 'series' : 'episode', url: item.url, title: item.title || 'Episode' });
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handleOpenEpisode = (ep) => {
    if (!ep?.url) return;
    setOverlay({ type: 'episode', url: ep.url, title: ep.title || 'Episode' });
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const handleOpenSeries = (url, title) => {
    if (!url) return;
    setOverlay({ type: 'series', url, title: title || 'Series' });
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const closeOverlay = () => {
    setOverlay(null);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const selectGenre = (slug, name) => {
    setListGenre(slug);
    setListPage(1);
    setTab('list');
    scrollRef.current?.scrollTo({ top: 0 });
  };

  const switchTab = (t) => {
    setTab(t);
    scrollRef.current?.scrollTo({ top: 0 });
  };

  /* ----- Derived list (filter source) ----- */
  const visibleResults = (listData?.results || []).filter((r) =>
    listSource === 'semua' ? true : r.source === listSource
  );

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayName = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const sortedSchedule = [...schedule].sort((a, b) => days.indexOf(a.day) - days.indexOf(b.day));

  const tabs = [
    { id: 'home', label: 'Beranda', icon: 'fa-home' },
    { id: 'list', label: 'List', icon: 'fa-list' },
    { id: 'jadwal', label: 'Jadwal', icon: 'fa-calendar' },
    { id: 'genre', label: 'Genre', icon: 'fa-tags' },
  ];

  return (
    <div ref={scrollRef} className="pb-6">
      {/* Header */}
      <div className="mb-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-500 to-orange-500 flex items-center justify-center shadow-lg shadow-rose-500/20">
            <i className="fas fa-tv text-white text-sm"></i>
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-primary tracking-tight">
              Pur<span className="gradient-text">TV</span>
            </h1>
            <p className="text-[10px] text-muted font-medium">Nonton Donghua & Anime Sub Indo</p>
          </div>
        </div>

        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="relative">
          <i className="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-muted text-xs"></i>
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Cari anime / donghua..."
            className="w-full bg-input border border-default rounded-2xl pl-10 pr-24 py-3 text-sm text-primary placeholder:text-muted focus:outline-none focus:border-accent/50 transition-colors"
          />
          <button
            type="submit"
            disabled={searchLoading}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-accent hover:bg-accent-hover text-white text-xs font-bold px-4 py-2 rounded-xl transition-all active:scale-95 disabled:opacity-50"
          >
            {searchLoading ? <i className="fas fa-spinner fa-spin"></i> : 'Cari'}
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto custom-scrollbar pb-1 -mx-1 px-1 snap-x snap-mandatory">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => switchTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex-shrink-0 snap-start whitespace-nowrap ${
              tab === t.id
                ? 'bg-accent text-white shadow-lg shadow-accent/25'
                : 'bg-card border border-default text-muted hover:text-white'
            }`}
          >
            <i className={`fas ${t.icon} text-[10px]`}></i>
            {t.label}
          </button>
        ))}
      </div>

      {/* ============ SEARCH RESULTS ============ */}
      {searchData && tab === 'home' && (
        <div className="mb-6 animate-fade-in">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-sm font-bold text-primary flex items-center gap-2">
              <i className="fas fa-search text-accent text-xs"></i>
              Hasil: <span className="text-accent">{searchQuery}</span>
            </h3>
            <button onClick={() => { setSearchData(null); setSearchQuery(''); }} className="text-[10px] text-muted hover:text-white font-bold">
              <i className="fas fa-times mr-1"></i> Tutup
            </button>
          </div>
          {searchLoading ? (
            <SkeletonGrid count={6} />
          ) : searchError ? (
            <div className="native-card p-6 text-center">
              <i className="fas fa-exclamation-triangle text-amber-400 text-2xl mb-2 block"></i>
              <p className="text-xs text-secondary">{searchError}</p>
            </div>
          ) : (searchData.results || []).length === 0 ? (
            <div className="native-card p-6 text-center">
              <i className="fas fa-search text-muted text-2xl mb-2 block"></i>
              <p className="text-xs text-muted">Tidak ada hasil untuk &quot;{searchQuery}&quot;.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
                {(searchData.results || []).map((item, i) => (
                  <div key={i} className="h-full"><MediaCard key={i} item={item} onClick={handleOpenItem} showType /></div>
                ))}
              </div>
              {searchData.hasNext && (
                <div className="mt-4 text-center">
                  <button
                    onClick={() => runSearch(searchQuery, searchPage + 1)}
                    className="bg-card border border-default text-secondary hover:text-white text-xs font-bold px-6 py-3 rounded-xl transition-all active:scale-95"
                  >
                    <i className="fas fa-chevron-down mr-1"></i> Muat Lebih Banyak
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ============ HOME TAB ============ */}
      {tab === 'home' && !searchData && (
        <div className="animate-fade-in">
          {homeLoading && <SkeletonGrid count={6} />}

          {homeError && (
            <div className="native-card p-6 text-center">
              <i className="fas fa-exclamation-triangle text-amber-400 text-2xl mb-2 block"></i>
              <p className="text-xs text-secondary mb-3">{homeError}</p>
              <button onClick={loadHome} className="text-xs bg-accent text-white font-bold px-4 py-2 rounded-xl">
                Coba Lagi
              </button>
            </div>
          )}

          {homeData && !homeLoading && (
            <>
              <FeaturedSlider items={homeData.featuredSlider} onClick={handleOpenItem} />

              <SectionRow
                title="Populer Hari Ini"
                icon="fa-fire"
                items={homeData.popularToday}
                onClick={handleOpenItem}
              />
              <SectionRow
                title="Rilis Terbaru"
                icon="fa-clock"
                items={homeData.latestReleases}
                onClick={handleOpenItem}
              />
              <SectionRow
                title="Ongoing Donghua"
                icon="fa-spinner"
                items={homeData.ongoing}
                onClick={handleOpenItem}
              />
              <SectionRow
                title="Anime Terbaru"
                icon="fa-bolt"
                items={homeData.anime?.latestAnime}
                onClick={handleOpenItem}
              />
              <SectionRow
                title="Anime Populer"
                icon="fa-star"
                items={homeData.anime?.popularAnime}
                onClick={handleOpenItem}
              />
            </>
          )}
        </div>
      )}

      {/* ============ LIST TAB ============ */}
      {tab === 'list' && (
        <div className="animate-fade-in">
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="text-sm font-bold text-primary flex items-center gap-2">
              <i className="fas fa-list text-accent text-xs"></i>
              {listGenre ? `Genre: ${listGenre}` : 'Semua'}
            </h3>
            {listGenre && (
              <button onClick={() => { setListGenre(''); setListPage(1); }} className="text-[10px] text-muted hover:text-white font-bold">
                <i className="fas fa-times mr-1"></i> Reset
              </button>
            )}
          </div>

          {/* Source filter */}
          <div className="flex gap-2 mb-4">
            {[
              { id: 'semua', label: 'Semua' },
              { id: 'anichin', label: 'Donghua' },
              { id: 'samehadaku', label: 'Anime' },
            ].map((s) => (
              <button
                key={s.id}
                onClick={() => setListSource(s.id)}
                className={`px-3.5 py-1.5 rounded-full text-[10px] font-bold transition-all active:scale-95 ${
                  listSource === s.id
                    ? 'bg-accent text-white'
                    : 'bg-card border border-default text-muted hover:text-white'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {listLoading ? (
            <SkeletonGrid count={6} />
          ) : listError ? (
            <div className="native-card p-6 text-center">
              <i className="fas fa-exclamation-triangle text-amber-400 text-2xl mb-2 block"></i>
              <p className="text-xs text-secondary mb-3">{listError}</p>
            </div>
          ) : visibleResults.length === 0 ? (
            <div className="native-card p-6 text-center">
              <i className="fas fa-film text-muted text-2xl mb-2 block"></i>
              <p className="text-xs text-muted">Tidak ada hasil.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 auto-rows-fr">
                {visibleResults.map((item, i) => (
                  <div key={i} className="h-full"><MediaCard key={i} item={item} onClick={handleOpenItem} showType /></div>
                ))}
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between mt-5">
                <button
                  disabled={listPage <= 1}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  className="bg-card border border-default text-secondary hover:text-white disabled:opacity-40 text-xs font-bold px-4 py-2.5 rounded-xl transition-all active:scale-95"
                >
                  <i className="fas fa-chevron-left mr-1"></i> Prev
                </button>
                <span className="text-[10px] text-muted font-mono">
                  Page {listData?.purtv_pagenation?.currentPage || listPage}
                </span>
                <button
                  disabled={!listData?.hasNext}
                  onClick={() => setListPage((p) => p + 1)}
                  className="bg-card border border-default text-secondary hover:text-white disabled:opacity-40 text-xs font-bold px-4 py-2.5 rounded-xl transition-all active:scale-95"
                >
                  Next <i className="fas fa-chevron-right ml-1"></i>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ============ JADWAL TAB ============ */}
      {tab === 'jadwal' && (
        <div className="animate-fade-in">
          <h3 className="text-sm font-bold text-primary mb-3 px-1 flex items-center gap-2">
            <i className="fas fa-calendar text-accent text-xs"></i> Jadwal Rilis
          </h3>
          {scheduleLoading ? (
            <div className="native-card p-8 flex flex-col items-center gap-3 animate-pulse">
              <div className="w-12 h-12 rounded-2xl bg-input flex items-center justify-center">
                <i className="fas fa-spinner fa-spin text-accent text-lg"></i>
              </div>
              <p className="text-xs text-muted">Memuat jadwal...</p>
            </div>
          ) : sortedSchedule.length === 0 ? (
            <div className="native-card p-6 text-center">
              <i className="fas fa-calendar text-muted text-2xl mb-2 block"></i>
              <p className="text-xs text-muted">Jadwal kosong.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedSchedule.map((day) => (
                <div key={day.day} className={`native-card overflow-hidden ${day.day === todayName ? 'ring-1 ring-accent/40' : ''}`}>
                  <div className={`px-4 py-2.5 flex items-center justify-between ${day.day === todayName ? 'bg-accent/10' : 'bg-input/50'}`}>
                    <span className="text-xs font-bold text-primary flex items-center gap-2">
                      <i className={`fas ${day.day === todayName ? 'fa-sun text-accent' : 'fa-calendar-day text-muted'} text-[10px]`}></i>
                      {day.day}
                    </span>
                    {day.day === todayName && (
                      <span className="text-[8px] bg-accent text-white px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">Hari ini</span>
                    )}
                  </div>
                  <div className="p-2">
                    {(day.list || []).map((item, i) => (
                      <button
                        key={i}
                        onClick={() => handleOpenItem(item)}
                        className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-input transition-colors text-left active:scale-[0.98]"
                      >
                        <div className="relative w-12 h-16 rounded-lg overflow-hidden bg-input flex-shrink-0">
                          {item.thumbnail && (
                            <Image
                              src={item.thumbnail}
                              alt={item.title || ''}
                              fill
                              sizes="48px"
                              className="object-cover"
                              unoptimized
                            />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-bold text-primary truncate">{item.title}</div>
                          <div className="text-[9px] text-muted mt-0.5">
                            {item.releaseTime && <span className="mr-2"><i className="fas fa-clock mr-0.5"></i>{item.releaseTime}</span>}
                            {item.nextEpisode && <span><i className="fas fa-play mr-0.5"></i>Ep {item.nextEpisode}</span>}
                          </div>
                        </div>
                        <i className="fas fa-chevron-right text-muted text-[10px]"></i>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ GENRE TAB ============ */}
      {tab === 'genre' && (
        <div className="animate-fade-in">
          <h3 className="text-sm font-bold text-primary mb-3 px-1 flex items-center gap-2">
            <i className="fas fa-tags text-accent text-xs"></i> Pilih Genre
          </h3>
          {genresLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-12 bg-input rounded-xl animate-pulse"></div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {genres.map((g) => (
                <button
                  key={g.slug}
                  onClick={() => selectGenre(g.slug, g.name)}
                  className="px-4 py-2.5 rounded-xl bg-card border border-default text-secondary hover:border-accent/40 hover:text-white text-[11px] font-bold transition-all active:scale-95"
                >
                  <i className="fas fa-tag text-accent text-[9px] mr-1.5"></i>
                  {g.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ============ OVERLAY: SERIES ============ */}
      {overlay?.type === 'series' && (
        <div className="fixed inset-0 z-[70] bg-[#09090b]/95 backdrop-blur-md overflow-y-auto custom-scrollbar">
          <div className="container mx-auto px-4 py-6 max-w-md md:max-w-3xl min-h-full">
            <SeriesView series={overlay} onBack={closeOverlay} onOpenEpisode={handleOpenEpisode} />
          </div>
        </div>
      )}

      {/* ============ OVERLAY: EPISODE ============ */}
      {overlay?.type === 'episode' && (
        <div className="fixed inset-0 z-[70] bg-[#09090b]/95 backdrop-blur-md overflow-y-auto custom-scrollbar">
          <div className="container mx-auto px-4 py-6 max-w-md md:max-w-3xl min-h-full">
            <EpisodeView episode={overlay} onBack={closeOverlay} onOpenSeries={handleOpenSeries} onOpenEpisode={handleOpenEpisode} />
          </div>
        </div>
      )}
    </div>
  );
}