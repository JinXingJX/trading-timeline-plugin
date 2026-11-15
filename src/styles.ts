// The dashboard lives in a shadow root: `:host` is its page, `cqw`/`cqh` and
// `@container daily-view` measure the view instead of the window.
export const styles = String.raw`
:host{
  color-scheme:light;
  --bg:#ffffff;--panel:#fbfbfa;--surface:#ffffff;--muted:#f3f3f1;--inset:#eeeeeb;
  --line:rgba(22,22,26,.09);--line-strong:rgba(22,22,26,.16);--line-active:rgba(22,22,26,.28);
  --text:#26262b;--text-strong:#16161a;--text-soft:#46464d;--text-muted:#6e6e76;
  --primary:#16161a;--primary-hover:#2e2e35;--primary-contrast:#ffffff;
  --accent:#2e5bff;--accent-soft:#eef2ff;--accent-line:#b8c7ff;
  --tone:#d9480f;--tone-soft:#fff1e8;
  --high:#a3360a;--high-soft:#fdede4;
  --up:#1e7b4f;--up-soft:#e9f5ee;--down:#a3360a;--down-soft:#fdede4;
  --ok:#1e7b4f;--bad:#c2410c;--bad-soft:#fdf1ec;--bad-line:#f2c9b5;
  --shadow-raised:0 1px 2px rgba(22,22,26,.08),0 0 0 1px var(--line);
  --shadow-active:0 8px 20px -12px rgba(22,22,26,.35);
  --shadow-modal:0 24px 64px -12px rgba(22,22,26,.3),0 0 0 1px var(--line);
  --focus:0 0 0 2px var(--bg),0 0 0 4px var(--accent);
  --sans:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Segoe UI",sans-serif;
  --mono:ui-monospace,"SF Mono",Menlo,monospace;
  font-family:var(--sans);
}
:host([data-daily-theme="dark"]){
  color-scheme:dark;
  --bg:#17171a;--panel:#131316;--surface:#1f1f24;--muted:#222227;--inset:#121215;
  --line:rgba(255,255,255,.08);--line-strong:rgba(255,255,255,.14);--line-active:rgba(255,255,255,.26);
  --text:#e2e2e5;--text-strong:#f2f2f3;--text-soft:#b4b4bb;--text-muted:#8c8c94;
  --primary:#f2f2f3;--primary-hover:#ffffff;--primary-contrast:#16161a;
  --accent:#7b95ff;--accent-soft:rgba(123,149,255,.14);--accent-line:rgba(123,149,255,.42);
  --tone:#ff8a52;--tone-soft:rgba(255,138,82,.14);
  --high:#ffa27a;--high-soft:rgba(255,138,82,.14);
  --up:#6fd29c;--up-soft:rgba(46,154,100,.16);--down:#ffa27a;--down-soft:rgba(255,138,82,.14);
  --ok:#6fd29c;--bad:#ff9a6e;--bad-soft:rgba(255,138,82,.1);--bad-line:rgba(255,138,82,.35);
  --shadow-raised:0 1px 2px rgba(0,0,0,.4),0 0 0 1px var(--line);
  --shadow-active:0 8px 20px -12px rgba(0,0,0,.8);
  --shadow-modal:0 24px 64px -12px rgba(0,0,0,.7),0 0 0 1px var(--line-strong);
}
*{box-sizing:border-box}
:host{overflow:hidden;background:var(--bg);color:var(--text);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
button:disabled{cursor:not-allowed;opacity:.45}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:none;box-shadow:var(--focus)}
.spin{animation:tl-spin 900ms linear infinite}
@keyframes tl-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.tl-grow{min-width:0;flex:1}
.tl-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tl-mono{font-family:var(--mono);font-size:.92em}

/* layout */
.timeline-app{display:flex;height:100cqh;overflow:hidden;background:var(--bg);color:var(--text)}
.timeline-loading{display:flex;height:100cqh;align-items:center;justify-content:center;gap:12px;color:var(--text-muted)}
.timeline-loading strong{display:block;color:var(--text-strong);font-size:14px}
.timeline-loading span{font-size:12px}

/* buttons */
.tl-btn{display:inline-flex;height:32px;flex:none;align-items:center;justify-content:center;gap:6px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);padding:0 12px;color:var(--text-strong);font-size:13px;font-weight:500;white-space:nowrap;transition:border-color .15s,background-color .15s}
.tl-btn:hover:not(:disabled){border-color:var(--line-active)}
.tl-btn.primary{border-color:var(--primary);background:var(--primary);color:var(--primary-contrast)}
.tl-btn.primary:hover:not(:disabled){border-color:var(--primary-hover);background:var(--primary-hover)}
.tl-btn.small{height:26px;gap:4px;border:0;background:var(--muted);padding:0 8px;font-size:12px}
.tl-icon-btn,.icon-button{display:inline-grid;width:30px;height:30px;flex:none;place-items:center;border:0;border-radius:8px;background:transparent;color:var(--text-soft)}
.tl-icon-btn:hover,.icon-button:hover{background:var(--muted);color:var(--text-strong)}
.icon-button.small{width:28px;height:28px}
.tl-link{border:0;background:transparent;padding:0;color:var(--accent);font-size:12px}
.tl-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:8px}

/* rail */
.tl-rail{display:flex;width:280px;flex:none;flex-direction:column;border-right:1px solid var(--line);background:var(--panel)}
.tl-rail-head{padding:16px 18px 12px}
.tl-rail-head h1{margin:0;color:var(--text-strong);font-size:15px;font-weight:600}
.tl-rail-head p{margin:2px 0 0;color:var(--text-muted);font-size:12px}
.tl-rail-body{display:flex;min-height:0;flex:1;flex-direction:column;gap:20px;overflow:auto;padding:0 12px 16px}
.tl-card{border:1px solid var(--line-strong);border-radius:12px;background:var(--surface);padding:12px}
.tl-card-row{display:flex;align-items:center;gap:8px;font-size:13px}
.tl-card-row strong{font-weight:500;color:var(--text-strong)}
.tl-card-note{margin:4px 0 0 16px;overflow:hidden;color:var(--text-muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.tl-led{width:8px;height:8px;flex:none;border-radius:50%;background:var(--text-muted)}
.tl-led.on{background:var(--ok);box-shadow:0 0 0 3px var(--up-soft)}
.tl-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 10px;margin:12px 0 0}
.tl-stats div{min-width:0}
.tl-stats dt{color:var(--text-muted);font-size:11.5px}
.tl-stats dd{margin:0;overflow:hidden;color:var(--text-strong);font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.tl-label{padding:0 6px 8px;color:var(--text-muted);font-size:11px;font-weight:500;letter-spacing:.04em}
.tl-label.with-action{display:flex;align-items:center;justify-content:space-between}
.tl-label-meta{font-weight:400;letter-spacing:0}
.tl-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.tl-summary div{border-radius:10px;background:var(--muted);padding:8px 10px}
.tl-summary strong{display:block;color:var(--text-strong);font-size:20px;font-weight:600;line-height:1.2}
.tl-summary strong.hot{color:var(--high)}
.tl-summary span{color:var(--text-muted);font-size:11.5px}
.tl-segmented{display:flex;gap:2px;border-radius:9px;background:var(--inset);padding:3px}
.tl-segmented button{height:28px;flex:1;border:0;border-radius:7px;background:transparent;color:var(--text-soft);font-size:12.5px}
.tl-segmented button[aria-pressed="true"]{background:var(--surface);color:var(--text-strong);font-weight:500;box-shadow:0 1px 2px rgba(0,0,0,.12)}
.tl-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 4px}
.tl-chips span{border-radius:7px;background:var(--surface);padding:2px 9px;box-shadow:0 0 0 1px var(--line-strong);font-family:var(--mono);font-size:12px}
.tl-chips.small{padding:0;margin-top:10px}
.tl-chips.small span{font-size:11.5px}
.tl-sources{display:flex;flex-direction:column}
.tl-source{display:flex;align-items:center;gap:9px;border-radius:8px;padding:6px;font-size:13px}
.tl-source small{flex:none;color:var(--text-muted);font-size:11px}
.tl-source.failing{background:var(--bad-soft)}
.tl-source.failing small{color:var(--bad);font-weight:500}
.tl-source.off{color:var(--text-muted)}
.tl-source-dot{width:6px;height:6px;flex:none;border-radius:50%}
.tl-source-dot.ok{background:var(--ok)}
.tl-source-dot.bad{border-radius:1px;background:var(--bad)}
.tl-source-dot.off{background:var(--line-active)}
.tl-runs{display:flex;flex-direction:column;gap:2px}
.tl-run{display:flex;align-items:flex-start;gap:8px;padding:5px 6px;color:var(--text-muted);font-size:12px}
.tl-run svg{flex:none;margin-top:3px}
.tl-run .ok{color:var(--ok)}.tl-run .bad{color:var(--bad)}.tl-run .muted{color:var(--text-muted)}
.tl-run strong{display:block;color:var(--text-soft);font-weight:500}
.tl-run span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* main */
.tl-main{display:flex;min-width:0;flex:1;flex-direction:column;background:var(--bg)}
.tl-bar{display:flex;min-height:52px;flex:none;flex-wrap:wrap;align-items:center;gap:8px;border-bottom:1px solid var(--line);padding:8px 16px 8px 24px}
.tl-bar-title{display:flex;min-width:0;flex:1;align-items:baseline;gap:10px}
.tl-bar-title strong{color:var(--text-strong);font-size:14px;font-weight:600}
.tl-bar-title span{overflow:hidden;color:var(--text-muted);font-size:12px;text-overflow:ellipsis;white-space:nowrap}
.tl-notice{display:flex;align-items:flex-start;gap:9px;margin:12px 24px 0;border:1px solid var(--line);border-radius:10px;background:var(--muted);padding:8px 8px 8px 12px;color:var(--text-soft);font-size:13px;line-height:1.6}
.tl-notice>svg{flex:none;margin-top:3px}
.tl-notice>span{min-width:0;flex:1;padding-top:1px}
.tl-notice.error{border-color:var(--bad-line);background:var(--bad-soft);color:var(--bad)}
.tl-notice.inline{margin:0}
.tl-scroll{min-height:0;flex:1;overflow:auto;padding:12px 24px 40px}
.tl-timeline{max-width:780px;margin:0 auto}
.tl-day+.tl-day{margin-top:8px}
.tl-day-label{position:sticky;top:-12px;z-index:2;margin:0;background:var(--bg);padding:12px 0 6px 84px;color:var(--text-muted);font-size:12px;font-weight:500}
.tl-row{display:grid;grid-template-columns:56px 28px minmax(0,1fr);align-items:stretch}
.tl-row-time{padding-top:15px;color:var(--text-muted);font-family:var(--mono);font-size:12.5px}
.tl-row.future .tl-row-time{color:var(--text-strong)}
.tl-row-node{position:relative;display:block}
.tl-row-node:before{content:"";position:absolute;top:0;bottom:0;left:50%;width:1px;background:var(--line-strong)}
.tl-row-node:after{content:"";position:absolute;top:19px;left:50%;width:9px;height:9px;transform:translateX(-50%);border:2px solid var(--line-active);border-radius:50%;background:var(--bg)}
.tl-row-node.impact-high:after{border-color:var(--tone)}
.tl-row.future .tl-row-node:after{border-color:var(--accent)}
.tl-row.future .tl-row-node.impact-high:after{border-color:var(--tone)}
.tl-row-node.status-completed:after{border-color:var(--text-muted);background:var(--text-muted)}
.tl-row-node.status-completed.impact-high:after{border-color:var(--tone);background:var(--tone)}
.tl-event{display:flex;width:100%;min-width:0;flex-direction:column;gap:3px;margin:6px 0 6px 6px;border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:11px 14px;text-align:left;transition:border-color .15s,box-shadow .15s}
.tl-row.future .tl-event{border-style:dashed;border-color:var(--line-strong)}
.tl-event:hover{border-color:var(--line-active)}
.tl-event.active,.tl-row.future .tl-event.active{border-style:solid;border-color:var(--text-strong);box-shadow:var(--shadow-active)}
.tl-event-head{display:flex;min-width:0;align-items:center;gap:8px}
.tl-event-title{min-width:0;flex:1;overflow:hidden;color:var(--text-strong);font-weight:500;text-overflow:ellipsis;white-space:nowrap}
.tl-event.active .tl-event-title{font-weight:600}
.tl-event-when{display:inline-flex;flex:none;align-items:center;gap:4px;color:var(--text-muted);font-size:12px}
.tl-event-when.analyzing{color:var(--accent)}
.tl-event-when.failed,.tl-event-when.retry{color:var(--bad)}
.tl-event-when.waiting{color:var(--tone)}
.tl-tag{flex:none;border-radius:5px;background:var(--muted);padding:1px 7px;color:var(--text-muted);font-size:11px;white-space:nowrap}
.tl-event-meta{display:flex;flex-wrap:wrap;gap:4px 10px;color:var(--text-muted);font-size:12px}
.tl-event-detail{display:-webkit-box;overflow:hidden;color:var(--text-soft);font-size:12.5px;line-height:1.6;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.tl-impact{flex:none;border-radius:5px;background:var(--muted);padding:1px 7px;color:var(--text-soft);font-size:11px;font-weight:500;white-space:nowrap}
.tl-impact.high{background:var(--high-soft);color:var(--high);font-weight:600}
.tl-impact.low{color:var(--text-muted)}
.tl-verdict{flex:none;font-size:12px;font-weight:500;white-space:nowrap}
.tl-verdict.bullish{color:var(--up)}.tl-verdict.bearish{color:var(--down)}.tl-verdict.mixed,.tl-verdict.neutral{color:var(--text-soft)}
.tl-now{display:grid;grid-template-columns:56px 28px auto minmax(0,1fr);align-items:center;gap:0;margin:6px 0}
.tl-now time{color:var(--accent);font-family:var(--mono);font-size:12px;font-weight:600}
.tl-now-dot{justify-self:center;width:11px;height:11px;border-radius:50%;background:var(--accent);box-shadow:0 0 0 4px var(--accent-soft)}
.tl-now-label{padding:0 8px 0 6px;color:var(--accent);font-size:11px;font-weight:600;letter-spacing:.06em}
.tl-now-line{height:1px;background:var(--accent-line)}
.tl-empty{max-width:420px;margin:12cqh auto 0;text-align:center}
.tl-empty-mark{display:inline-grid;width:44px;height:44px;place-items:center;border-radius:12px;background:var(--tone-soft);color:var(--tone)}
.tl-empty h2{margin:16px 0 0;color:var(--text-strong);font-size:18px;font-weight:600}
.tl-empty p{margin:8px 0 20px;color:var(--text-soft);font-size:13px;line-height:1.7}

/* inspector */
.tl-inspector{display:flex;width:360px;flex:none;flex-direction:column;border-left:1px solid var(--line);background:var(--panel)}
.tl-inspector-empty{display:flex;height:100%;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px;color:var(--text-muted);font-size:13px;text-align:center}
.tl-dossier{display:flex;min-height:0;height:100%;flex-direction:column}
.tl-dossier-head{border-bottom:1px solid var(--line);padding:18px 20px 16px}
.tl-dossier-meta{display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:12px}
.tl-dossier-head h2{margin:8px 0 0;color:var(--text-strong);font-size:19px;font-weight:600;line-height:1.35;letter-spacing:-.01em}
.tl-dossier-body{display:flex;min-height:0;flex:1;flex-direction:column;gap:20px;overflow:auto;padding:18px 20px}
.tl-dossier-actions{display:flex;flex:none;gap:8px;border-top:1px solid var(--line);padding:12px 20px 16px}
.tl-verdict-card{border:1px solid var(--line-strong);border-radius:12px;background:var(--surface);padding:14px}
.tl-verdict-top{display:flex;justify-content:space-between;color:var(--text-muted);font-size:12px}
.tl-verdict-big{display:flex;align-items:center;gap:6px;margin-top:4px;color:var(--text-strong);font-size:22px;font-weight:600}
.tl-verdict-big.bullish{color:var(--up)}.tl-verdict-big.bearish{color:var(--down)}
.tl-confidence{height:4px;margin-top:10px;overflow:hidden;border-radius:4px;background:var(--inset)}
.tl-confidence span{display:block;height:100%;border-radius:4px;background:var(--text-strong)}
.tl-verdict-card p{margin:12px 0 0;color:var(--text);font-size:13px;line-height:1.7}
.tl-section h3{margin:0 0 8px;color:var(--text-soft);font-size:12px;font-weight:500}
.tl-section p{margin:0;color:var(--text);font-size:13px;line-height:1.7}
.tl-quote{border-radius:10px;background:var(--muted);padding:10px 12px}
.tl-muted{color:var(--text-muted)!important}
.tl-assets{overflow:hidden;border:1px solid var(--line-strong);border-radius:12px;background:var(--surface)}
.tl-asset{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--line);padding:9px 12px;font-size:13px}
.tl-asset:last-child{border-bottom:0}
.tl-asset strong{width:60px;flex:none;color:var(--text-strong);font-weight:500}
.tl-asset-reason{min-width:0;flex:1;color:var(--text-muted);font-size:12px;line-height:1.5}
.tl-direction{flex:none;font-weight:500;font-size:12.5px}
.tl-direction.up{color:var(--up)}.tl-direction.down{color:var(--down)}.tl-direction.volatile,.tl-direction.unclear{color:var(--text-soft)}
.tl-scenarios{margin:0;padding-left:18px;color:var(--text);font-size:13px;line-height:1.7}
.tl-evidence{display:flex;flex-direction:column}
.tl-evidence>a,.tl-evidence>div{display:flex;align-items:baseline;gap:8px;border-bottom:1px solid var(--line);padding:7px 0;color:var(--text);font-size:13px;text-decoration:none}
.tl-evidence>a:hover{color:var(--accent)}
.tl-evidence>:last-child{border-bottom:0}
.tl-evidence small{flex:none;color:var(--text-muted);font-size:11.5px}
.tl-countdown{display:flex;align-items:center;gap:12px;border:1px solid var(--accent-line);border-radius:12px;background:var(--accent-soft);padding:12px 14px;color:var(--accent)}
.tl-countdown span{display:block;font-size:12px}
.tl-countdown strong{display:block;color:var(--text-strong);font-size:15px;font-weight:600}

/* dialogs */
.overlay{position:fixed;inset:0;z-index:50;display:grid;place-items:center;background:rgba(22,22,26,.36);padding:24px}
:host([data-daily-theme="dark"]) .overlay{background:rgba(0,0,0,.6)}
.panel{display:flex;width:min(560px,100%);max-height:calc(100cqh - 48px);flex-direction:column;overflow:hidden;border-radius:16px;background:var(--surface);box-shadow:var(--shadow-modal)}
.settings-panel{width:min(640px,100%)}
.panel-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border-bottom:1px solid var(--line);padding:18px 20px 14px}
.panel-header h2{margin:0;color:var(--text-strong);font-size:17px;font-weight:600}
.panel-header span{display:block;margin-top:2px;color:var(--text-muted);font-size:12.5px}
.panel-body{display:flex;min-height:0;flex-direction:column;gap:16px;overflow:auto;padding:18px 20px}
.panel-footer{display:flex;justify-content:flex-end;gap:8px;border-top:1px solid var(--line);padding:12px 20px}
.field{display:flex;min-width:0;flex-direction:column;gap:6px}
.field>span{color:var(--text-soft);font-size:12.5px;font-weight:500}
.field small{margin-left:6px;color:var(--text-muted);font-weight:400}
.field input,.field select,.field textarea,.source-editor-row input{width:100%;min-width:0;height:36px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);padding:0 10px;font-size:13px;outline:none}
.field textarea{height:auto;min-height:84px;resize:vertical;padding:8px 10px;line-height:1.6}
.field input:hover,.field select:hover,.field textarea:hover{border-color:var(--line-active)}
.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.sources-editor{display:flex;flex-direction:column;gap:8px;border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:12px}
.editor-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.editor-heading>div{display:flex;align-items:center;gap:7px;color:var(--text-soft);font-size:12.5px;font-weight:500}
.editor-heading>.source-add{gap:6px;color:inherit;font-weight:inherit}
.preset-select{height:32px;max-width:180px;border:1px solid var(--line-strong);border-radius:8px;background:var(--surface);padding:0 8px;color:var(--text-strong);font-size:13px;outline:none}
.preset-select:hover:not(:disabled){border-color:var(--line-active)}
.source-editor-row{display:flex;align-items:center;gap:10px;border-radius:10px;background:var(--surface);padding:8px;box-shadow:0 0 0 1px var(--line)}
.source-editor-row>div{display:grid;min-width:0;flex:1;gap:6px}
.source-editor-row input{height:30px;font-size:12.5px}
.source-editor-row .url-input{font-family:var(--mono);color:var(--text-soft)}
.source-toggle{display:inline-flex;width:36px;height:22px;flex:none;align-items:center;border:0;border-radius:999px;background:var(--line-strong);padding:3px;transition:background-color .15s}
.source-toggle span{width:16px;height:16px;border-radius:50%;background:var(--bg);box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}
.source-toggle.enabled{background:var(--primary)}
.source-toggle.enabled span{transform:translateX(14px)}
.settings-note{display:flex;align-items:flex-start;gap:8px;border-radius:10px;background:var(--muted);padding:10px 12px;color:var(--text-soft);font-size:12.5px;line-height:1.6}
.settings-note svg{flex:none;margin-top:2px}

/* narrow */
@container daily-view (max-width:1180px){.tl-inspector{width:320px}.tl-rail{width:248px}}
@container daily-view (max-width:900px){
  .timeline-app{flex-direction:column;overflow:auto;height:auto;min-height:100cqh}
  .tl-rail,.tl-inspector{width:auto;border:0;border-bottom:1px solid var(--line)}
  .tl-rail-body{max-height:none}
  .field-grid{grid-template-columns:minmax(0,1fr)}
}
`;
