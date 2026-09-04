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
.nc-btn--primary:hover{filter:brightness(1.05)}
.nc-iconbtn{cursor:pointer;border:1px solid transparent;background:none;border-radius:8px;padding:.35rem;color:var(--nc-muted);
  display:inline-flex;align-items:center;justify-content:center}
.nc-iconbtn:hover{background:var(--nc-hover);color:var(--nc-text)}
.nc-iconbtn[aria-pressed="true"]{color:var(--nc-accent)}

/* ---- header control cluster (in the site's sticky top nav) ---- */
.nc-header{display:inline-flex;align-items:center;gap:.1rem;margin-right:.5rem}
.nc-hbtn{cursor:pointer;border:none;background:none;color:#f0efec;padding:.4rem;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;line-height:0}
.nc-hbtn:hover{background:rgba(255,255,255,.16)}
.nc-hbtn--in{color:#fbbf24}
.nc-acct{width:214px}
.nc-acct__name{font-size:.85rem;font-weight:600;color:var(--nc-text);margin-bottom:.1rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nc-acct__email{font-size:.75rem;color:var(--nc-muted);margin-bottom:.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* ---- answers ---- */
.nc-answer{margin:.6rem 0 .1rem;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}
.nc-answer__ta{width:100%;box-sizing:border-box;min-height:3.2rem;padding:.55rem .65rem;border:1px solid var(--nc-border);
  border-radius:8px;font:inherit;font-size:.95rem;resize:vertical;background:var(--nc-surface);color:var(--nc-text)}
.nc-answer__ta:focus{outline:none;border-color:var(--nc-accent)}
.nc-answer__ta:disabled{background:var(--nc-hover);color:var(--nc-muted)}
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
.nc-seg__btn[aria-pressed="true"]{background:#292524;color:#fff}
html.nc-dark .nc-seg__btn[aria-pressed="true"]{background:#e7e5e4;color:#1c1917}

/* ---- selection toolbar (pill) ---- */
.nc-toolbar{position:fixed;z-index:9500;display:flex;align-items:center;gap:.15rem;background:var(--nc-surface);
  border:1px solid var(--nc-border);border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.22);padding:.3rem .45rem;
  transform:translateX(-50%)}
.nc-swatch{cursor:pointer;border:none;background:none;padding:.35rem;display:inline-flex}
.nc-swatch>span{display:block;width:1.05rem;height:1.05rem;border-radius:999px;transition:opacity .12s,box-shadow .12s;opacity:.85}
.nc-swatch:hover>span{opacity:1}
.nc-swatch[aria-pressed="true"]>span{opacity:1;box-shadow:0 0 0 2px var(--nc-surface),0 0 0 4px #a8a29e}
.nc-swatch--amber>span{background:var(--nc-amber)}.nc-swatch--sky>span{background:var(--nc-sky)}
.nc-swatch--rose>span{background:var(--nc-rose)}.nc-swatch--emerald>span{background:var(--nc-emerald)}
.nc-toolbar__div{width:1px;height:1.1rem;background:var(--nc-border);margin:0 .15rem}
.nc-toolbar__btn{cursor:pointer;border:none;background:none;padding:.35rem;color:var(--nc-muted);display:inline-flex;border-radius:6px}
.nc-toolbar__btn:hover{color:var(--nc-text);background:var(--nc-hover)}
.nc-toolbar__btn--danger:hover{color:var(--nc-rose)}

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
.nc-flash{animation:nc-flash 1.6s ease}
@keyframes nc-flash{0%,40%{background:var(--nc-amber-wash)}100%{background:transparent}}
`
