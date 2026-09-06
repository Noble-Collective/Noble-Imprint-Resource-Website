// All CSS for the reader per-user data layer, injected once. Palette mirrors Coram Deo
// (amber/sky/rose/emerald highlights on a warm stone neutral) and adapts to the resource site,
// including a first-pass dark theme scoped to html.nc-dark.
export function injectStyles() {
  if (document.getElementById('nc-styles')) return
  const s = document.createElement('style')
  s.id = 'nc-styles'
  s.textContent = CSS
  document.head.appendChild(s)
}

const CSS = `
:root{
  --nc-amber:#fbbf24; --nc-sky:#38bdf8; --nc-rose:#fb7185; --nc-emerald:#34d399;
  --nc-amber-wash:#fef3c7; --nc-sky-wash:#e0f2fe; --nc-rose-wash:#ffe4e6; --nc-emerald-wash:#d1fae5;
  --nc-surface:#fff; --nc-border:#e7e5e4; --nc-text:#292524; --nc-muted:#78716c;
  --nc-hover:#f5f5f4; --nc-accent:#b45309;
  --nc-font-scale:1;
}
html.nc-dark{
  --nc-amber-wash:#78350f; --nc-sky-wash:#0c4a6e; --nc-rose-wash:#881337; --nc-emerald-wash:#064e3b;
  --nc-surface:#1c1917; --nc-border:#292524; --nc-text:#e7e5e4; --nc-muted:#a8a29e;
  --nc-hover:#292524; --nc-accent:#fbbf24;
}
/* ---- reading-area Text Size (scales paragraphs + headings proportionally). Font Style is
   handled by overriding the site's --font-reading variable in settings.js. ---- */
.session-content p, .reading-content p, .session-content li, .reading-content li{ font-size:calc(17px * var(--nc-font-scale,1)) !important; }
.session-content h1, .reading-content h1{ font-size:calc(2rem * var(--nc-font-scale,1)) !important; }
.session-content h2, .reading-content h2{ font-size:calc(1.6rem * var(--nc-font-scale,1)) !important; }
.session-content h3, .reading-content h3{ font-size:calc(1.35rem * var(--nc-font-scale,1)) !important; }
.session-content h4, .reading-content h4{ font-size:calc(1.15rem * var(--nc-font-scale,1)) !important; }

/* ---- dark theme: flip the site's own CSS custom properties (whole-site, clean) ---- */
html.nc-dark{
  --color-bg:#1c1917; --color-bg-warm:#26221f; --color-bg-sidebar:#12100e;
  --color-border:#3a3633; --color-text:#e6e3df; --color-text-light:#a8a29e; --color-charcoal:#e6e3df;
}
html.nc-dark body{ background:#0c0a09; color:var(--color-text); }
html.nc-dark .reading-content, html.nc-dark .session-content,
html.nc-dark .session-content p, html.nc-dark .session-content li,
html.nc-dark .session-content blockquote, html.nc-dark .session-content td,
html.nc-dark .session-content strong, html.nc-dark .session-content em{ color:var(--color-text); }
html.nc-dark .session-content h1, html.nc-dark .session-content h2, html.nc-dark .session-content h3,
html.nc-dark .session-content h4, html.nc-dark .session-content h5, html.nc-dark .session-content h6{ color:#f2efe9; }
html.nc-dark .session-content a{ color:#93c5fd; }
html.nc-dark .question-block{ background:var(--color-bg-warm); }
html.nc-dark img:not([src*=".svg"]){ filter:brightness(.88); }

/* ---- Bible verse layout: 'Verse' mode puts each verse on its own line (hanging indent) ---- */
html.nc-verse-line .bible-content .bible-verse{ display:block; margin:.2rem 0; padding-left:1.5rem; text-indent:-1.5rem; }
html.nc-verse-line .bible-content .bible-verse .verse-num{ font-weight:700; }
/* Audio-enabled chapters render flat paragraphs with inline <sup>N</sup> verse numbers (no
   .bible-verse wrapper — the DOM must match the audio timestamps). A block ::before before each
   verse number forces a line break without touching the DOM, so verse mode works there too and
   audio sync is unaffected. */
html.nc-verse-line .bible-content .bible-paragraph sup{ font-weight:700; }
html.nc-verse-line .bible-content .bible-paragraph sup::before{ content:''; display:block; margin-top:.35rem; }
html.nc-verse-line .bible-content .bible-paragraph sup:first-child::before{ margin-top:0; }

/* ---- reader top bar ---- */
.nc-bar{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin:0 0 1.6rem;padding:.5rem .7rem;
  border:1px solid var(--nc-border);border-radius:10px;background:var(--nc-surface);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:.9rem;color:var(--nc-text)}
.nc-bar__msg{color:var(--nc-muted);font-size:.85rem}
.nc-bar__spacer{flex:1 1 auto}
.nc-btn{cursor:pointer;border:1px solid var(--nc-border);background:var(--nc-surface);border-radius:8px;
  padding:.35rem .7rem;font:inherit;font-size:.82rem;color:var(--nc-text);display:inline-flex;align-items:center;gap:.35rem;line-height:1}
.nc-btn:hover{background:var(--nc-hover)}
.nc-btn--primary{background:var(--nc-accent);color:#fff;border-color:transparent}
/* keep the accent bg on hover — .nc-btn:hover (class+pseudo) would otherwise outrank the base
   .nc-btn--primary rule and wash it to --nc-hover, leaving white-on-near-white (invisible) text */
.nc-btn--primary:hover{background:var(--nc-accent);color:#fff;filter:brightness(1.08)}
.nc-iconbtn{cursor:pointer;border:1px solid transparent;background:none;border-radius:8px;padding:.35rem;color:var(--nc-muted);
  display:inline-flex;align-items:center;justify-content:center}
.nc-iconbtn:hover{background:var(--nc-hover);color:var(--nc-text)}
.nc-iconbtn[aria-pressed="true"]{color:var(--nc-accent)}

/* ---- control cluster at the TOP of the left sidebar (Coram-Deo-style) ---- */
.nc-side{display:flex;align-items:center;gap:.15rem;margin-top:-.9rem;padding:.15rem .85rem .5rem;border-bottom:1px solid var(--color-border,#e2e6df)}
.nc-sbtn{cursor:pointer;border:none;background:none;color:var(--color-text-light,#6b6b6b);padding:.42rem;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;line-height:0}
.nc-sbtn:hover{background:rgba(120,120,120,.16);color:var(--color-text,#3a3a3a)}
.nc-sbtn--in{color:var(--color-gold,#dfb53b)}
/* fast custom tooltip (native title has a ~1s delay we can't shorten) */
.nc-sbtn{position:relative}
.nc-sbtn[data-tip]::after{content:attr(data-tip);position:absolute;top:100%;left:0;margin-top:6px;white-space:nowrap;
  background:var(--nc-text,#292524);color:var(--nc-surface,#fff);font-size:.7rem;line-height:1.2;padding:.28rem .45rem;border-radius:6px;
  box-shadow:0 4px 14px rgba(0,0,0,.2);opacity:0;pointer-events:none;transform:translateY(-2px);transition:opacity .1s,transform .1s;
  transition-delay:0s;z-index:10000}
.nc-sbtn[data-tip]:hover::after{opacity:1;transform:none;transition-delay:.15s}
.nc-side--mobile .nc-sbtn[data-tip]::after{left:auto;right:0} /* stay on-screen from the right-aligned header cluster */
/* mobile: a second cluster in the (dark) top header, shown only where the sidebar is hidden */
.nc-side--mobile{display:none}
@media (max-width:989px){
  .sidebar .nc-side{display:none}
  .nc-side--mobile{display:flex;align-items:center;gap:.05rem;margin:0;padding:0;border:none}
  .nc-side--mobile .nc-sbtn{color:#e7e5e4}
  .nc-side--mobile .nc-sbtn:hover{background:rgba(255,255,255,.16);color:#fff}
  .nc-side--mobile .nc-sbtn--in{color:var(--color-gold,#dfb53b)}
}
.nc-acct{width:214px}
.nc-acct__head{display:flex;align-items:center;gap:.5rem;margin-bottom:.7rem}
.nc-acct__avatar{width:34px;height:34px;border-radius:999px;flex:none;object-fit:cover;background:var(--nc-hover)}
.nc-acct__avatar--initials{display:inline-flex;align-items:center;justify-content:center;font-size:.9rem;font-weight:600;color:var(--nc-text)}
/* Account BUTTON avatar (signed in) — replaces the account icon, matching Coram Deo. */
.nc-sbtn__avatar{width:22px;height:22px;border-radius:999px;object-fit:cover;flex:none;display:inline-flex;align-items:center;justify-content:center}
.nc-sbtn__avatar--initials{background:var(--color-gold,#dfb53b);color:#fff;font-size:.7rem;font-weight:700;line-height:1}
.nc-sbtn--avatar{padding:.34rem}
.nc-acct__info{min-width:0}
.nc-acct__name{font-size:.85rem;font-weight:600;color:var(--nc-text);margin-bottom:.05rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-acct__email{font-size:.75rem;color:var(--nc-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-acct__link{width:100%;box-sizing:border-box;cursor:pointer;border:none;background:none;font:inherit;font-size:.82rem;color:var(--nc-text);
  display:flex;align-items:center;gap:.5rem;padding:.45rem .5rem;border-radius:8px;text-align:left;margin-bottom:.35rem}
.nc-acct__link:hover{background:var(--nc-hover)}
.nc-acct__ico{display:inline-flex;align-items:center;color:var(--nc-muted)}
.nc-acct__data{margin-top:.55rem;border-top:1px solid var(--nc-border);padding-top:.35rem}
.nc-acct__data-sum{cursor:pointer;font-size:.68rem;color:var(--nc-muted);opacity:.75;padding:.3rem .5rem;list-style:none;user-select:none}
.nc-acct__data-sum::-webkit-details-marker{display:none}
.nc-acct__data-sum:hover{color:var(--nc-text)}
.nc-acct__link--danger{color:var(--nc-rose)}
.nc-acct__link--danger:hover{background:var(--nc-rose-wash)}
.nc-signin{width:260px}
.nc-signin__body{font-size:.82rem;color:var(--nc-muted);line-height:1.4;margin:.15rem 0 .7rem}
.nc-signin .nc-btn--primary{width:100%;justify-content:center;padding:.5rem}
/* "Continue reading" strip on the home page */
.nc-continue{margin:0 0 1.6rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-continue__title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--nc-muted);margin-bottom:.5rem}
.nc-continue__row{display:flex;gap:.6rem;overflow-x:auto;padding-bottom:.35rem}
.nc-continue__card{flex:0 0 auto;min-width:190px;max-width:240px;border:1px solid var(--nc-border);border-radius:10px;
  padding:.6rem .7rem;text-decoration:none;color:var(--nc-text);background:var(--nc-surface);transition:border-color .12s}
.nc-continue__card:hover{border-color:var(--nc-accent)}
.nc-continue__book{font-size:.82rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-continue__sess{font-size:.75rem;color:var(--nc-muted);margin-top:.15rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* one-time onboarding coach-mark */
.nc-coach{position:fixed;z-index:9800;width:280px;background:var(--nc-surface);color:var(--nc-text);
  border:1px solid var(--nc-border);border-radius:12px;box-shadow:0 12px 34px rgba(0,0,0,.22);padding:.8rem .85rem;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;animation:nc-coach-in .18s ease}
@keyframes nc-coach-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.nc-coach__title{font-size:.9rem;font-weight:700;margin-bottom:.25rem}
.nc-coach__body{font-size:.82rem;color:var(--nc-muted);line-height:1.45;margin-bottom:.6rem}
.nc-coach .nc-btn--primary{width:100%;justify-content:center;padding:.45rem}

/* ---- answers ---- */
.nc-answer{margin:.6rem 0 .1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-answer__ta{width:100%;box-sizing:border-box;min-height:3.2rem;padding:.55rem .65rem;border:1px solid var(--nc-border);
  border-radius:8px;font:inherit;font-size:.95rem;resize:vertical;background:var(--nc-surface);color:var(--nc-text)}
.nc-answer__ta:focus{outline:none;border-color:var(--nc-accent)}
.nc-answer__ta:disabled{background:var(--nc-hover);color:var(--nc-muted)}
.nc-answer__ta--locked{cursor:pointer;background:var(--nc-hover)}
.nc-answer__ta--locked::placeholder{font-style:italic;color:var(--nc-accent);opacity:1}
.nc-answer__status{display:block;margin-top:.15rem;font-size:.72rem;color:var(--nc-muted);min-height:1em}

/* ---- popover menus (settings) ---- */
.nc-menu{position:fixed;z-index:9000;background:var(--nc-surface);border:1px solid var(--nc-border);border-radius:12px;
  box-shadow:0 10px 30px rgba(0,0,0,.18);padding:.75rem;width:290px;color:var(--nc-text);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-menu__row{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:.5rem 0}
.nc-menu__row:first-child{padding-top:0}.nc-menu__row:last-child{padding-bottom:0}
.nc-menu__label{font-size:.85rem;color:var(--nc-muted)}
.nc-seg{display:inline-flex;gap:.25rem}
.nc-seg__btn{cursor:pointer;border:none;background:var(--nc-hover);color:var(--nc-muted);border-radius:6px;padding:.2rem .55rem;font:inherit;font-size:.78rem}
.nc-seg__btn:hover{background:var(--nc-border)}
.nc-menu__section{font-size:.66rem;font-weight:700;text-transform:uppercase;letter-spacing:.09em;color:var(--nc-muted);padding:.15rem .1rem .25rem}
.nc-menu__section--divider{border-top:1px solid var(--nc-border);margin-top:.5rem;padding-top:.6rem}
.nc-seg__btn[aria-pressed="true"]{background:#292524;color:#fff}
html.nc-dark .nc-seg__btn[aria-pressed="true"]{background:#e7e5e4;color:#1c1917}

/* ---- selection toolbar (pill) ---- */
.nc-toolbar{position:fixed;z-index:9500;display:flex;align-items:center;gap:.15rem;background:var(--nc-surface);
  border:1px solid var(--nc-border);border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:.3rem .45rem;
  transform:translateX(-50%)}
/* Share dropdown off the toolbar's share button (Copy text / Copy link / Share…). */
.nc-share-menu{position:fixed;z-index:9600;background:var(--nc-surface);border:1px solid var(--nc-border);
  border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:.25rem;min-width:132px;color:var(--nc-text);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-share-menu__item{display:block;width:100%;text-align:left;cursor:pointer;border:none;background:none;color:inherit;
  font:inherit;font-size:.82rem;padding:.42rem .6rem;border-radius:6px}
.nc-share-menu__item:hover{background:var(--nc-hover)}
.nc-swatch{cursor:pointer;border:none;background:none;padding:.35rem;display:inline-flex;border-radius:6px;transition:background .12s}
.nc-swatch:hover{background:var(--nc-hover)}
.nc-swatch>span{display:block;width:1.05rem;height:1.05rem;border-radius:999px;transition:opacity .12s,box-shadow .12s,transform .12s;opacity:.85}
.nc-swatch:hover>span{opacity:1;transform:scale(1.14);box-shadow:0 0 0 2px var(--nc-surface),0 0 0 3px rgba(0,0,0,.14)}
.nc-swatch[aria-pressed="true"]>span{opacity:1;box-shadow:0 0 0 2px var(--nc-surface),0 0 0 4px #a8a29e}
.nc-swatch--amber>span{background:var(--nc-amber)}.nc-swatch--sky>span{background:var(--nc-sky)}
.nc-swatch--rose>span{background:var(--nc-rose)}.nc-swatch--emerald>span{background:var(--nc-emerald)}
.nc-toolbar__div{width:1px;height:1.1rem;background:var(--nc-border);margin:0 .15rem}
.nc-toolbar__btn{cursor:pointer;border:none;background:none;padding:.35rem;color:var(--nc-muted);display:inline-flex;border-radius:6px}
.nc-toolbar__btn:hover{color:var(--nc-text);background:var(--nc-hover)}
.nc-toolbar__btn--danger:hover{color:var(--nc-rose)}
.nc-toolbar__btn--on{color:var(--nc-accent)}
/* fast custom tooltip on the selection toolbar (swatches + action buttons) — matches the sidebar
   cluster tips; native title has a ~1s delay we can't shorten. Rendered ABOVE the button so it
   never covers the selected text the toolbar sits over. */
.nc-swatch,.nc-toolbar__btn{position:relative}
.nc-swatch[data-tip]::after,.nc-toolbar__btn[data-tip]::after{content:attr(data-tip);position:absolute;bottom:100%;left:50%;margin-bottom:7px;white-space:nowrap;
  background:var(--nc-text,#292524);color:var(--nc-surface,#fff);font-size:.68rem;line-height:1.2;padding:.26rem .45rem;border-radius:6px;
  box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;pointer-events:none;transform:translateX(-50%) translateY(2px);transition:opacity .1s,transform .1s;
  transition-delay:0s;z-index:10001}
.nc-swatch[data-tip]:hover::after,.nc-toolbar__btn[data-tip]:hover::after{opacity:1;transform:translateX(-50%);transition-delay:.15s}
/* brief floating confirmation toast (e.g. "Copied") */
.nc-toast{position:fixed;z-index:9600;transform:translate(-50%,-100%);background:var(--nc-text,#292524);color:var(--nc-surface,#fff);
  font-size:.72rem;font-weight:500;padding:.3rem .55rem;border-radius:6px;box-shadow:0 6px 18px rgba(0,0,0,.25);
  opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-toast--show{opacity:1;transform:translate(-50%,-120%)}

/* ---- painted highlights ---- */
mark.nc-hl{border-radius:3px;padding:0 .02em;color:inherit;cursor:pointer;background:var(--nc-amber-wash)}
mark.nc-hl--amber{background:var(--nc-amber-wash)}mark.nc-hl--sky{background:var(--nc-sky-wash)}
mark.nc-hl--rose{background:var(--nc-rose-wash)}mark.nc-hl--emerald{background:var(--nc-emerald-wash)}
html.nc-dark mark.nc-hl{color:#f5f5f4}
mark.nc-note-mark{background:transparent;border-bottom:2px dotted var(--nc-accent);border-radius:0;cursor:pointer}

/* ---- note markers + popover ---- */
.nc-note-dot{cursor:pointer;color:var(--nc-accent);vertical-align:super;font-size:.7em;margin:0 .1em;user-select:none}
.nc-note-pop{position:fixed;z-index:9500;width:270px;background:var(--nc-surface);border:1px solid var(--nc-border);
  border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:.6rem;transform:translateX(-50%);
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-note-pop textarea{width:100%;box-sizing:border-box;min-height:4.5rem;border:1px solid var(--nc-border);border-radius:8px;
  padding:.5rem;font:inherit;font-size:.85rem;resize:vertical;background:var(--nc-surface);color:var(--nc-text)}
.nc-note-pop textarea:focus{outline:none;border-color:var(--nc-accent)}
.nc-note-pop__actions{display:flex;justify-content:flex-end;gap:.4rem;margin-top:.5rem}
.nc-note-quote{font-size:.75rem;color:var(--nc-muted);margin-bottom:.4rem;border-left:2px solid var(--nc-accent);padding-left:.5rem;font-style:italic}

/* ---- positioned bookmark markers ---- */
.nc-bm-marker{color:var(--nc-accent);margin-right:.15em;cursor:pointer;user-select:none}

/* ---- library slide-out panel ---- */
.nc-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:9600;opacity:0;transition:opacity .18s}
.nc-backdrop.open{opacity:1}
/* ---- notebook bottom sheet (with Highlights/Notes/Bookmarks tabs) ---- */
.nc-sheet{position:fixed;left:50%;bottom:0;transform:translate(-50%,100%);z-index:9700;width:min(720px,100%);max-height:74vh;
  background:var(--nc-surface);color:var(--nc-text);border-top-left-radius:16px;border-top-right-radius:16px;
  box-shadow:0 -10px 40px rgba(0,0,0,.28);display:flex;flex-direction:column;transition:transform .26s ease;
  font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-sheet.open{transform:translate(-50%,0)}
.nc-sheet__grip{width:42px;height:4px;border-radius:2px;background:var(--nc-border);margin:.55rem auto .15rem}
.nc-sheet__head{display:flex;align-items:center;justify-content:space-between;padding:.05rem 1rem .35rem}
.nc-sheet__tabs{display:flex;gap:.25rem;padding:.25rem .75rem;border-bottom:1px solid var(--nc-border)}
.nc-tab{flex:1 1 0;cursor:pointer;border:none;background:none;color:var(--nc-muted);font:inherit;font-size:.82rem;padding:.5rem .3rem;border-radius:8px;white-space:nowrap}
.nc-tab:hover{background:var(--nc-hover)}
.nc-tab[aria-selected="true"]{background:var(--nc-hover);color:var(--nc-text);font-weight:600}
.nc-sheet__search{padding:.5rem .85rem .15rem}
.nc-search{width:100%;box-sizing:border-box;border:1px solid var(--nc-border);border-radius:8px;padding:.4rem .6rem;
  font:inherit;font-size:.85rem;background:var(--nc-surface);color:var(--nc-text)}
.nc-search:focus{outline:none;border-color:var(--nc-accent)}
.nc-sheet__head .nc-iconbtn--ok{color:var(--nc-emerald)}
.nc-panel__group{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--nc-muted);margin:.7rem .25rem .15rem}
.nc-panel__item--orphan{opacity:.7}
.nc-panel__item--orphan .nc-panel__main{cursor:default}
.nc-panel__orphan{font-size:.7rem;color:var(--nc-rose);margin-top:.25rem}
.nc-sheet__body{overflow:auto;padding:.4rem .85rem 1.6rem}
.nc-panel{position:fixed;top:0;right:0;height:100%;width:min(400px,90vw);background:var(--nc-surface);color:var(--nc-text);
  z-index:9700;box-shadow:-8px 0 30px rgba(0,0,0,.2);transform:translateX(100%);transition:transform .22s ease;
  display:flex;flex-direction:column;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-panel.open{transform:translateX(0)}
.nc-panel__head{display:flex;align-items:center;justify-content:space-between;padding:.9rem 1rem;border-bottom:1px solid var(--nc-border)}
.nc-panel__title{font-size:1rem;font-weight:600}
.nc-panel__body{overflow:auto;padding:.5rem .75rem 2rem}
.nc-panel__section{margin-top:1rem}
.nc-panel__h{font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--nc-muted);margin:.4rem .25rem}
.nc-panel__item{display:flex;align-items:flex-start;gap:.5rem;border:1px solid var(--nc-border);background:none;color:inherit;
  border-radius:8px;padding:.5rem .6rem;margin:.3rem 0;font:inherit;font-size:.85rem}
.nc-panel__item:hover{background:var(--nc-hover)}
.nc-panel__item--focus{outline:2px solid var(--nc-accent);outline-offset:1px}
.nc-panel__main{flex:1 1 auto;min-width:0;cursor:pointer;text-align:left;background:none;border:none;color:inherit;font:inherit;padding:0}
.nc-panel__sess{font-size:.7rem;color:var(--nc-muted);margin-top:.2rem}
.nc-panel__del{flex:none;border:none;background:none;color:var(--nc-muted);cursor:pointer;padding:.15rem;border-radius:6px;line-height:0}
.nc-panel__del:hover{color:var(--nc-rose);background:var(--nc-hover)}
/* Always-reachable floating button to open the notebook */
.nc-fab{position:fixed;right:20px;bottom:20px;z-index:9400;width:48px;height:48px;border-radius:999px;border:none;
  background:var(--nc-accent);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,.28);cursor:pointer;display:none;align-items:center;justify-content:center}
.nc-fab:hover{filter:brightness(1.08)}
.nc-panel__item .nc-dot{display:inline-block;width:.7rem;height:.7rem;border-radius:999px;margin-right:.4rem;vertical-align:middle}
.nc-panel__q{color:var(--nc-muted);font-size:.78rem;margin-bottom:.15rem}
.nc-panel__empty{color:var(--nc-muted);font-size:.8rem;padding:.3rem .25rem}
/* notebook sheet footer (link to the full cross-book page) */
.nc-sheet__foot{border-top:1px solid var(--nc-border);padding:.5rem .85rem;display:flex;align-items:center;justify-content:space-between;gap:.5rem}
.nc-sheet__all{font-size:.8rem;color:var(--nc-accent);text-decoration:none}
.nc-sheet__all:hover{text-decoration:underline}
.nc-sheet__exportlink{border:none;background:none;cursor:pointer;font:inherit;font-size:.72rem;color:var(--nc-muted);opacity:.8;padding:.1rem .2rem}
.nc-sheet__exportlink:hover{color:var(--nc-text);text-decoration:underline}
.nc-mn-export{border:none;background:none;cursor:pointer;font:inherit;font-size:.75rem;color:var(--nc-muted);opacity:.8;white-space:nowrap;padding:.1rem .2rem}
.nc-mn-export:hover{color:var(--nc-text);text-decoration:underline}
/* "My Notes" cross-book page (/notes) */
.nc-mynotes__bar{display:flex;align-items:center;gap:.6rem;margin:.5rem 0 1.1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-mynotes__bar .nc-search{flex:1 1 auto}
.nc-mynotes__count{font-size:.75rem;color:var(--nc-muted);white-space:nowrap}
/* book accordion */
.nc-mn-book{border:1px solid var(--nc-border);border-radius:12px;margin:.7rem 0;overflow:hidden;background:var(--nc-surface)}
.nc-mn-book[open]{box-shadow:0 2px 14px rgba(0,0,0,.06)}
.nc-mn-book__sum{display:flex;align-items:center;gap:.85rem;padding:.7rem .85rem;cursor:pointer;list-style:none}
.nc-mn-book__sum::-webkit-details-marker{display:none}
.nc-mn-book__sum:hover{background:var(--nc-hover)}
.nc-mn-book__cover{flex:none;width:46px;height:62px;border-radius:5px;overflow:hidden;background:var(--nc-hover);
  box-shadow:0 1px 4px rgba(0,0,0,.18);display:block}
.nc-mn-book__cover img{width:100%;height:100%;object-fit:cover;display:block}
.nc-mn-book__cover--none{background:linear-gradient(135deg,var(--nc-hover),var(--nc-border))}
.nc-mn-book__info{flex:1 1 auto;min-width:0}
.nc-mn-book__title{font-weight:600;font-size:.95rem;color:var(--nc-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-mn-book__count{font-size:.78rem;color:var(--nc-muted);margin-top:.15rem}
.nc-mn-book__chevron{flex:none;width:9px;height:9px;border-right:2px solid var(--nc-muted);border-bottom:2px solid var(--nc-muted);
  transform:rotate(-45deg);transition:transform .18s;margin-right:.2rem}
.nc-mn-book[open] .nc-mn-book__chevron{transform:rotate(45deg)}
.nc-mn-book__body{padding:.2rem .85rem 1rem}
.nc-mn-kind{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--nc-muted);margin:.8rem 0 .3rem}
.nc-mynotes__item{display:block;text-decoration:none;color:var(--nc-text);border:1px solid var(--nc-border);border-radius:8px;
  padding:.55rem .65rem;margin:.35rem 0;font-size:.9rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;transition:border-color .12s,background .12s}
.nc-mynotes__item:hover{border-color:var(--nc-accent);background:var(--nc-hover)}
.nc-mynotes__item .nc-dot{display:inline-block;width:.7rem;height:.7rem;border-radius:999px;margin-right:.45rem;vertical-align:middle}
.nc-mynotes__body{color:var(--nc-muted);font-size:.82rem;margin-top:.25rem}
.nc-mynotes__sess{font-size:.72rem;color:var(--nc-muted);margin-top:.3rem;opacity:.85}
.nc-mynotes__q{font-weight:600;font-size:.85rem;color:var(--nc-text);margin-bottom:.2rem}
.nc-mynotes__ans{color:var(--nc-muted);font-size:.85rem}
.nc-mynotes__empty{color:var(--nc-muted);margin-bottom:.6rem}
.nc-mynotes-page .page-title{margin-bottom:.2rem}
.nc-flash{animation:nc-flash 1.6s ease}
@keyframes nc-flash{0%,40%{background:var(--nc-amber-wash)}100%{background:transparent}}
/* Clear "here's the spot" emphasis when jumping from the notebook: amber wash + left accent bar,
   held then faded, visible in both themes. box-shadow avoids any layout shift. */
.nc-jumpflash{border-radius:4px;animation:nc-jump 2.4s cubic-bezier(.4,0,.2,1)}
@keyframes nc-jump{
  0%,68%{background:var(--nc-amber-wash);box-shadow:inset 4px 0 0 var(--nc-amber),0 0 0 4px var(--nc-amber-wash)}
  100%{background:transparent;box-shadow:inset 4px 0 0 transparent,0 0 0 4px transparent}
}
/* Temporary emphasis on the passage a shared #:~:text= link points at — hold, then fade. */
mark.nc-share-hl{background:var(--nc-amber-wash);color:inherit;border-radius:3px;box-decoration-break:clone;-webkit-box-decoration-break:clone;animation:nc-share-fade 3.2s ease forwards}
@keyframes nc-share-fade{0%,70%{background:var(--nc-amber-wash)}100%{background:transparent}}
`
