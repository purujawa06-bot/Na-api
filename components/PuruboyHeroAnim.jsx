'use client';

import React, { useEffect, useState } from 'react';

const QUOTES = [
  'Jangan berhenti sampai kamu bangga.',
  'Proses lebih penting dari sekadar hasil.',
  'Langkah kecil setiap hari membawa perubahan besar.',
  'Hidup adalah perjalanan, bukan perlombaan.',
  'Kegagalan adalah guru terbaik, bukan akhir segalanya.',
  'Nikmati prosesnya, hasil tak pernah mengkhianati usaha.',
  'Badai pasti berlalu, tetaplah bertahan dan bertumbuh.',
  'Percayalah pada dirimu, kamu lebih kuat dari yang kamu bayangkan.',
  'Bahagia bukan memiliki segalanya, tapi mensyukuri apa yang ada.',
  'Jangan menunggu waktu yang tepat, ciptakanlah waktumu sendiri.',
];

const BRAND_MS = 4200;
const QUOTE_MS = 4200;

/**
 * PuruBoyHeroAnim — built-in looping hero animation (no logo).
 * Loop: [PuruBoy API anim] -> [quote slide] -> [PuruBoy API anim] -> [next quote] ... (10 quotes)
 * Theme-native: transparent bg, menyatu dengan --bg-main.
 * CSS + tiny timer, no external dep (AMAN buat CI).
 */
export default function PuruboyHeroAnim() {
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const isBrand = cycle % 2 === 0;
    const t = setTimeout(() => setCycle((c) => c + 1), isBrand ? BRAND_MS : QUOTE_MS);
    return () => clearTimeout(t);
  }, [cycle]);

  const isBrand = cycle % 2 === 0;
  const quoteIdx = Math.floor(cycle / 2) % QUOTES.length;

  const word1 = 'PuruBoy';
  const word2 = 'API';
  const baseDelay = (i) => `${(i * 0.06).toFixed(2)}s`;

  return (
    <div className="pb-hero">
      <style>{`
        .pb-hero{width:100%;max-width:620px;margin:0 auto;display:flex;align-items:center;justify-content:center;min-height:150px;position:relative;overflow:hidden;padding:18px 20px;background:transparent;text-align:center}
        .pb-center{width:100%;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .pb-brand{font-size:clamp(28px,7vw,46px);font-weight:900;letter-spacing:-1px;color:var(--text-primary,#fafafa);line-height:1;display:flex;white-space:nowrap;font-family:'Poppins',sans-serif;justify-content:center}
        .pb-brand span{display:inline-block;opacity:0;animation:pb-letter-in .6s cubic-bezier(.16,1,.3,1) forwards}
        .pb-brand.out span{animation:pb-letter-out .4s ease-in forwards}
        @keyframes pb-letter-in{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
        @keyframes pb-letter-out{from{opacity:1;transform:translateY(0)}to{opacity:0;transform:translateY(-14px)}}
        .pb-brand .hl{background:linear-gradient(135deg,#f472b6 0%,#a855f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
        .pb-sub{margin-top:10px;font-size:11px;letter-spacing:2.5px;color:var(--text-secondary,#a1a1aa);font-weight:700;display:flex;align-items:center;gap:8px;white-space:nowrap;opacity:0;animation:pb-fade-in .5s ease-out forwards;animation-delay:.7s}
        @keyframes pb-fade-in{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:translateX(0)}}
        .pb-live{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 10px #22c55e;flex-shrink:0;animation:pb-blink .9s linear infinite}
        @keyframes pb-blink{0%,100%{opacity:1}50%{opacity:.2}}
        .pb-bar{margin-top:10px;width:100%;max-width:260px;height:4px;background:var(--border-color,#27272a);border-radius:99px;overflow:hidden;opacity:0;animation:pb-fade-in .5s ease-out forwards;animation-delay:.85s}
        .pb-fill{width:40%;height:100%;background:linear-gradient(90deg,#f472b6,#a855f7);border-radius:99px;animation:pb-scan 1.8s ease-in-out infinite alternate}
        @keyframes pb-scan{from{transform:translateX(-60%)}to{transform:translateX(250%)}}
        .pb-quote{font-size:clamp(15px,4vw,20px);font-weight:600;color:var(--text-primary,#fafafa);line-height:1.5;max-width:520px;font-family:'Poppins',sans-serif;opacity:0;animation:pb-quote-in .6s cubic-bezier(.16,1,.3,1) forwards}
        .pb-quote-mark{font-size:28px;background:linear-gradient(135deg,#f472b6,#a855f7);-webkit-background-clip:text;background-clip:text;color:transparent;line-height:1;margin-bottom:6px}
        .pb-quote-count{margin-top:10px;font-size:10px;letter-spacing:2px;color:var(--text-muted,#71717a);font-weight:700}
        @keyframes pb-quote-in{from{opacity:0;transform:translateX(60px)}to{opacity:1;transform:translateX(0)}}
        .pb-fade{animation:pb-all-fade .45s ease-in forwards}
        @keyframes pb-all-fade{from{opacity:1}to{opacity:0;transform:translateY(-10px)}}
        @media (max-width:480px){.pb-hero{padding:14px;min-height:132px}.pb-sub{font-size:9px;letter-spacing:1.5px}.pb-bar{max-width:190px}}
      `}</style>

      {isBrand ? (
        <div className="pb-center" key={'b' + cycle}>
          <div className="pb-brand">
            {[...word1].map((c, i) => (
              <span key={'a' + i} style={{ animationDelay: baseDelay(i) }}>{c}</span>
            ))}
            <span style={{ animationDelay: baseDelay(word1.length) }}>&nbsp;</span>
            {[...word2].map((c, i) => (
              <span key={'c' + i} className="hl" style={{ animationDelay: baseDelay(word1.length + 1 + i) }}>{c}</span>
            ))}
          </div>
          <div className="pb-sub"><span className="pb-live"></span><span>FREE REST API • ONLINE</span></div>
          <div className="pb-bar"><div className="pb-fill"></div></div>
        </div>
      ) : (
        <div className="pb-center" key={'q' + cycle}>
          <div className="pb-quote-mark">“</div>
          <div className="pb-quote">{QUOTES[quoteIdx]}</div>
          <div className="pb-quote-count">{String(quoteIdx + 1).padStart(2, '0')} / {String(QUOTES.length).padStart(2, '0')}</div>
        </div>
      )}
    </div>
  );
}
