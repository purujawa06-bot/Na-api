'use client';

import React from 'react';

/**
 * PuruBoyHeroAnim — built-in looping hero animation.
 * Theme-native: transparent bg, menyatu dengan --bg-main + .background-animation.
 * No iframe, no external dep, CSS-only loop (AMAN buat CI).
 */
export default function PuruboyHeroAnim() {
  const word1 = 'PuruBoy';
  const word2 = 'API';

  const letters1 = [...word1];
  const letters2 = [...word2];

  // total loop 4.8s, stagger per huruf
  const baseDelay = (i) => `${(i * 0.06).toFixed(2)}s`;

  return (
    <div className="pb-hero">
      <style>{`
        .pb-hero{width:100%;max-width:620px;margin:0 auto;display:flex;align-items:center;justify-content:center;gap:16px;position:relative;overflow:hidden;padding:18px 20px;background:transparent}
        .pb-mark{position:relative;width:104px;height:104px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
        .pb-ring{position:absolute;inset:0;width:100%;height:100%;animation:pb-spin 6s linear infinite}
        @keyframes pb-spin{to{transform:rotate(1turn)}}
        .pb-core{width:70px;height:70px;border-radius:20px;background:linear-gradient(135deg,#f472b6,#a855f7,#6366f1);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:30px;color:#fff;box-shadow:0 8px 30px rgba(236,72,153,.35);animation:pb-pulse 1.6s ease-in-out infinite}
        @keyframes pb-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.08)}}
        .pb-dot{position:absolute;width:8px;height:8px;border-radius:50%;background:#f472b6;animation:pb-dot 1.2s ease-in-out infinite}
        .pb-dot.d2{background:#a855f7;animation-delay:.25s}
        .pb-dot.d3{background:#6366f1;animation-delay:.5s}
        @keyframes pb-dot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.8);opacity:.5}}
        .pb-txt{min-width:0;flex-shrink:1}
        .pb-brand{font-size:clamp(26px,6vw,42px);font-weight:900;letter-spacing:-1px;color:var(--text-primary,#fafafa);line-height:1;display:flex;white-space:nowrap;font-family:'Poppins',sans-serif}
        .pb-brand span{display:inline-block;opacity:0;animation:pb-letter 4.8s cubic-bezier(.16,1,.3,1) infinite}
        .pb-brand .hl{background:linear-gradient(135deg,#f472b6 0%,#a855f7 100%);-webkit-background-clip:text;background-clip:text;color:transparent;-webkit-text-fill-color:transparent}
        @keyframes pb-letter{0%{opacity:0;transform:translateY(40px)}8%{opacity:1;transform:translateY(0)}80%{opacity:1;transform:translateY(0)}88%,100%{opacity:0;transform:translateY(-14px)}}
        .pb-sub{margin-top:8px;font-size:11px;letter-spacing:2.5px;color:var(--text-secondary,#a1a1aa);font-weight:700;display:flex;align-items:center;gap:8px;white-space:nowrap;opacity:0;animation:pb-fade 4.8s ease-out infinite;animation-delay:.5s}
        @keyframes pb-fade{0%{opacity:0;transform:translateX(-12px)}8%{opacity:1;transform:translateX(0)}80%{opacity:1;transform:translateX(0)}88%,100%{opacity:0;transform:translateY(-10px)}}
        .pb-live{width:8px;height:8px;border-radius:50%;background:#22c55e;box-shadow:0 0 10px #22c55e;flex-shrink:0;animation:pb-blink .9s linear infinite}
        @keyframes pb-blink{0%,100%{opacity:1}50%{opacity:.2}}
        .pb-bar{margin-top:10px;width:100%;max-width:260px;height:4px;background:var(--border-color,#27272a);border-radius:99px;overflow:hidden;opacity:0;animation:pb-fade 4.8s ease-out infinite;animation-delay:.65s}
        .pb-fill{width:40%;height:100%;background:linear-gradient(90deg,#f472b6,#a855f7);border-radius:99px;animation:pb-scan 1.8s ease-in-out infinite alternate}
        @keyframes pb-scan{from{transform:translateX(-60%)}to{transform:translateX(250%)}}
        @media (max-width:480px){.pb-hero{gap:12px;padding:14px 14px}.pb-mark{width:78px;height:78px}.pb-core{width:54px;height:54px;font-size:24px;border-radius:16px}.pb-brand{font-size:27px;letter-spacing:-.5px}.pb-sub{font-size:9px;letter-spacing:1.5px}.pb-bar{max-width:190px}}
        @media (max-width:340px){.pb-brand{font-size:24px}.pb-mark{width:68px;height:68px}.pb-core{width:48px;height:48px;font-size:22px}}
      `}</style>

      <div className="pb-mark">
        <svg className="pb-ring" viewBox="0 0 110 110">
          <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(236,72,153,.45)" strokeWidth="2" strokeDasharray="12 10" strokeLinecap="round" />
        </svg>
        <div className="pb-core">P</div>
        <div className="pb-dot" style={{ top: '6px', left: '50%' }}></div>
        <div className="pb-dot d2" style={{ bottom: '8px', left: '12px' }}></div>
        <div className="pb-dot d3" style={{ bottom: '8px', right: '12px' }}></div>
      </div>

      <div className="pb-txt">
        <div className="pb-brand">
          {letters1.map((c, i) => (
            <span key={'a' + i} style={{ animationDelay: baseDelay(i) }}>{c}</span>
          ))}
          <span style={{ animationDelay: baseDelay(letters1.length) }}>&nbsp;</span>
          {letters2.map((c, i) => (
            <span key={'b' + i} className="hl" style={{ animationDelay: baseDelay(letters1.length + 1 + i) }}>{c}</span>
          ))}
        </div>
        <div className="pb-sub"><span className="pb-live"></span><span>FREE REST API • ONLINE</span></div>
        <div className="pb-bar"><div className="pb-fill"></div></div>
      </div>
    </div>
  );
}
