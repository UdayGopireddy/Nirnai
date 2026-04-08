use axum::http::header;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse};

/// GET / — NirnAI homepage: intent capture + decision engine entry point
pub async fn index() -> impl IntoResponse {
    let html = build_homepage_html();
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(html),
    )
}

fn build_homepage_html() -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NirnAI — Clear decisions. Every purchase.</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>">
<style>
:root {{
  --bg-page: #06080f;
  --bg-card: #0c1017;
  --bg-raised: #111827;
  --bg-surface: #1a2233;
  --border-subtle: #1e293b;
  --border-hover: #334155;
  --accent: #818cf8;
  --accent-strong: #6366f1;
  --accent-glow: rgba(99,102,241,0.15);
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #475569;
  --green: #34d399;
  --orange: #fbbf24;
  --red: #f87171;
}}

* {{ margin: 0; padding: 0; box-sizing: border-box; }}

body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg-page);
  color: var(--text-primary);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
}}

/* ── Ambient glow behind hero ── */
.ambient {{
  position: fixed;
  top: -200px;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 600px;
  background: radial-gradient(ellipse, rgba(99,102,241,0.08) 0%, transparent 70%);
  pointer-events: none;
  z-index: 0;
}}

/* ── Nav ── */
nav {{
  position: sticky;
  top: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 28px;
  background: rgba(6,8,15,0.85);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--border-subtle);
}}

.nav-brand {{
  display: flex;
  align-items: center;
  gap: 8px;
  text-decoration: none;
}}

.nav-brand span {{ font-size: 20px; }}

.nav-brand h1 {{
  font-size: 18px;
  font-weight: 800;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}}

.nav-links {{
  display: flex;
  gap: 24px;
  align-items: center;
}}

.nav-links a {{
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 600;
  text-decoration: none;
  transition: color 0.15s;
}}

.nav-links a:hover {{ color: var(--text-primary); }}

.nav-cta {{
  background: var(--accent-strong);
  color: #fff !important;
  padding: 7px 16px;
  border-radius: 8px;
  font-weight: 700 !important;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 2px 10px rgba(99,102,241,0.3);
}}

.nav-cta:hover {{
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(99,102,241,0.45);
}}

/* ── Hero Section ── */
.hero {{
  position: relative;
  z-index: 1;
  max-width: 680px;
  margin: 0 auto;
  padding: 80px 24px 40px;
  text-align: center;
}}

.hero h2 {{
  font-size: 44px;
  font-weight: 900;
  line-height: 1.1;
  letter-spacing: -0.5px;
  margin-bottom: 16px;
}}

.hero h2 .gradient {{
  background: linear-gradient(135deg, var(--accent), #a78bfa, var(--green));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}}

.hero .subtitle {{
  font-size: 17px;
  color: var(--text-secondary);
  max-width: 460px;
  margin: 0 auto 40px;
  line-height: 1.55;
}}

/* ── Intent Input ── */
.intent-box {{
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 20px;
  padding: 28px;
  max-width: 580px;
  margin: 0 auto;
  transition: border-color 0.2s, box-shadow 0.2s;
}}

.intent-box:focus-within {{
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-glow), 0 8px 32px rgba(0,0,0,0.3);
}}

/* ── Tab Switcher ── */
.mode-tabs {{
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  background: var(--bg-raised);
  border-radius: 10px;
  padding: 3px;
}}

.mode-tab {{
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}}

.mode-tab:hover {{ color: var(--text-secondary); }}

.mode-tab.active {{
  background: var(--accent-strong);
  color: #fff;
  box-shadow: 0 2px 8px rgba(99,102,241,0.3);
}}

.mode-tab .tab-icon {{ font-size: 14px; }}

/* ── Input Panels ── */
.mode-panel {{ display: none; }}
.mode-panel.active {{ display: block; }}

.input-group {{
  margin-bottom: 14px;
}}

.input-group label {{
  display: block;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}}

.input-group input,
.input-group textarea {{
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  background: var(--bg-raised);
  color: var(--text-primary);
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}}

.input-group input:focus,
.input-group textarea:focus {{
  border-color: var(--accent);
}}

/* ── Autocomplete dropdown ── */
.ac-wrap {{ position: relative; }}
.ac-dropdown {{
  display: none;
  position: absolute;
  top: 100%;
  left: 0; right: 0;
  z-index: 50;
  background: var(--bg-raised);
  border: 1px solid var(--border-hover);
  border-top: none;
  border-radius: 0 0 10px 10px;
  max-height: 320px;
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.4);
}}
.ac-dropdown.open {{ display: block; }}
.ac-item {{
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  cursor: pointer;
  transition: background 0.12s;
}}
.ac-item:hover, .ac-item.active {{
  background: var(--bg-surface);
}}
.ac-icon {{
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  font-size: 16px;
  flex-shrink: 0;
}}
.ac-text {{ flex: 1; min-width: 0; }}
.ac-name {{
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}}
.ac-region {{
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}}

.input-group input::placeholder,
.input-group textarea::placeholder {{
  color: var(--text-muted);
}}

.input-group textarea {{
  resize: vertical;
  min-height: 80px;
}}

.input-row {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}}

.go-btn {{
  width: 100%;
  padding: 14px;
  border: none;
  border-radius: 12px;
  background: var(--accent-strong);
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s;
  box-shadow: 0 4px 16px rgba(99,102,241,0.35);
  margin-top: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}}

.go-btn:hover {{
  transform: translateY(-2px);
  box-shadow: 0 6px 24px rgba(99,102,241,0.5);
}}

.go-btn:disabled {{
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}}

.go-btn .btn-spinner {{
  display: none;
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}}

.go-btn.loading .btn-text {{ display: none; }}
.go-btn.loading .btn-spinner {{ display: block; }}

@keyframes spin {{ to {{ transform: rotate(360deg); }} }}

/* ── Trust Signals ── */
.trust-bar {{
  display: flex;
  justify-content: center;
  gap: 32px;
  margin-top: 48px;
  padding: 20px 0;
}}

.trust-item {{
  text-align: center;
}}

.trust-item .trust-icon {{
  font-size: 24px;
  margin-bottom: 6px;
}}

.trust-item .trust-label {{
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}}

/* ── How It Works ── */
.how-it-works {{
  max-width: 680px;
  margin: 0 auto;
  padding: 60px 24px;
}}

.how-it-works h3 {{
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--accent);
  text-align: center;
  margin-bottom: 32px;
}}

.steps {{
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}}

.step {{
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  padding: 24px 18px;
  text-align: center;
  transition: border-color 0.2s, transform 0.2s;
}}

.step:hover {{
  border-color: var(--border-hover);
  transform: translateY(-2px);
}}

.step-num {{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(99,102,241,0.1);
  color: var(--accent);
  font-size: 13px;
  font-weight: 800;
  margin-bottom: 12px;
}}

.step-icon {{ font-size: 28px; margin-bottom: 10px; }}

.step h4 {{
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 6px;
}}

.step p {{
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}}

/* ── What You Get ── */
.features {{
  max-width: 680px;
  margin: 0 auto;
  padding: 40px 24px 60px;
}}

.features h3 {{
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--accent);
  text-align: center;
  margin-bottom: 24px;
}}

.feature-grid {{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}}

.feature {{
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 18px 16px;
}}

.feature-icon {{ font-size: 22px; margin-bottom: 8px; }}

.feature h4 {{
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 4px;
}}

.feature p {{
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.45;
}}

/* ── Footer ── */
footer {{
  text-align: center;
  padding: 32px 24px;
  border-top: 1px solid var(--border-subtle);
  font-size: 11px;
  color: var(--text-muted);
}}

/* ── Processing Overlay ── */
.processing {{
  display: none;
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(6,8,15,0.92);
  backdrop-filter: blur(8px);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 20px;
}}

.processing.active {{ display: flex; }}

.processing-spinner {{
  width: 48px;
  height: 48px;
  border: 4px solid var(--border-subtle);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}}

.processing h3 {{
  font-size: 18px;
  font-weight: 700;
}}

.processing p {{
  font-size: 13px;
  color: var(--text-secondary);
  max-width: 320px;
  text-align: center;
  line-height: 1.5;
}}

.processing .stage {{
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}}

.processing .stage-item {{
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
  transition: color 0.3s;
}}

.processing .stage-item.done {{ color: var(--green); }}
.processing .stage-item.active {{ color: var(--text-primary); }}

/* ── Error Toast ── */
.toast {{
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%) translateY(100px);
  background: var(--red);
  color: #fff;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  z-index: 300;
  transition: transform 0.3s ease;
  pointer-events: none;
}}

.toast.show {{
  transform: translateX(-50%) translateY(0);
}}

/* ── Inventory Results ── */
.inv-header {{
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}}

.inv-header h4 {{
  font-size: 14px;
  font-weight: 700;
  color: var(--accent);
}}

.inv-header .inv-badge {{
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--green);
  background: rgba(52,211,153,0.1);
  border: 1px solid rgba(52,211,153,0.2);
  padding: 3px 10px;
  border-radius: 20px;
}}

.inv-card {{
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 14px 16px;
  margin-bottom: 8px;
  display: flex;
  gap: 14px;
  align-items: flex-start;
  transition: border-color 0.15s;
}}

.inv-card:hover {{
  border-color: var(--border-hover);
}}

.inv-card .rank {{
  font-size: 20px;
  font-weight: 800;
  color: var(--accent);
  min-width: 28px;
}}

.inv-card .info {{
  flex: 1;
  min-width: 0;
}}

.inv-card .title {{
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}}

.inv-card .meta {{
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 3px;
}}

.inv-card .score {{
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  padding: 2px 8px;
  border-radius: 8px;
  margin-top: 5px;
}}

.inv-card .score.book {{ color: var(--green); background: var(--green-bg); border: 1px solid var(--green-border); }}
.inv-card .score.think {{ color: var(--orange); background: var(--orange-bg); border: 1px solid var(--orange-border); }}
.inv-card .score.skip {{ color: var(--red); background: var(--red-bg); border: 1px solid var(--red-border); }}

.inv-card .price-tag {{
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary);
  white-space: nowrap;
}}

.inv-card a {{
  color: var(--accent);
  text-decoration: none;
  font-size: 11px;
  font-weight: 600;
}}

.inv-card a:hover {{
  text-decoration: underline;
}}

.inv-cta {{
  display: inline-block;
  margin-top: 8px;
  padding: 6px 16px;
  background: var(--accent);
  color: #fff !important;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  text-decoration: none !important;
  transition: opacity 0.15s;
}}

.inv-cta:hover {{
  opacity: 0.85;
  text-decoration: none !important;
}}

.inv-thumb {{
  width: 80px;
  height: 60px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
}}

.inv-fresh {{
  font-size: 10px;
  color: var(--text-muted);
  text-align: center;
  margin-top: 10px;
  line-height: 1.5;
}}

.inv-divider {{
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 8px;
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
}}

.inv-divider::before, .inv-divider::after {{
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-subtle);
}}

/* ── Mobile ── */
@media (max-width: 600px) {{
  .hero h2 {{ font-size: 30px; }}
  .hero .subtitle {{ font-size: 14px; }}
  .hero {{ padding: 50px 16px 24px; }}
  .intent-box {{ padding: 20px 16px; margin: 0 8px; }}
  .input-row {{ grid-template-columns: 1fr; }}
  .steps {{ grid-template-columns: 1fr; }}
  .feature-grid {{ grid-template-columns: 1fr; }}
  .trust-bar {{ flex-wrap: wrap; gap: 20px; }}
  .nav-links {{ gap: 12px; }}
  .nav-links a:not(.nav-cta) {{ display: none; }}
}}
</style>
</head>
<body>

<div class="ambient"></div>

<nav>
  <a href="/" class="nav-brand">
    <span>🛡️</span>
    <h1>NirnAI</h1>
  </a>
  <div class="nav-links">
    <a href="#how-it-works">How it works</a>
    <a href="https://chromewebstore.google.com" target="_blank" class="nav-cta">Get Extension</a>
  </div>
</nav>

<section class="hero">
  <h2>Clear decisions.<br><span class="gradient">Every purchase.</span></h2>
  <p class="subtitle">Find the best option — not just more options. Paste a link, search, or compare.</p>

  <div class="intent-box">
    <div class="mode-tabs">
      <button class="mode-tab active" data-mode="link">
        <span class="tab-icon">🔗</span> Paste Link
      </button>
      <button class="mode-tab" data-mode="search">
        <span class="tab-icon">🔍</span> Search
      </button>
      <button class="mode-tab" data-mode="compare">
        <span class="tab-icon">⚖️</span> Compare
      </button>
    </div>

    <!-- Mode 1: Paste a link -->
    <div class="mode-panel active" id="panel-link">
      <div class="input-group">
        <label>Product or listing URL</label>
        <input type="url" id="link-input" placeholder="https://airbnb.com/rooms/… or amazon.com/dp/…" autocomplete="off">
      </div>
      <button class="go-btn" id="go-link" onclick="handleLink()">
        <span class="btn-text">Analyze →</span>
        <span class="btn-spinner"></span>
      </button>
    </div>

    <!-- Mode 2: Search -->
    <div class="mode-panel" id="panel-search">
      <div class="input-group ac-wrap">
        <label>What are you looking for?</label>
        <input type="text" id="search-input" placeholder="Hotels in Miami, noise-cancelling headphones, running shoes…" autocomplete="off">
        <div class="ac-dropdown" id="ac-dropdown"></div>
      </div>

      <!-- Travel filters — shown when a travel query is detected -->
      <div id="travel-filters" style="display:none;">
        <div style="display:flex;align-items:center;gap:8px;margin:8px 0 6px;">
          <span style="font-size:14px;">🗓️</span>
          <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Trip Details</span>
          <span style="font-size:10px;color:#475569;margin-left:auto;">optional — or include in your search above</span>
        </div>
        <div class="input-row" style="grid-template-columns:1fr 1fr;">
          <div class="input-group">
            <label>Check-in</label>
            <input type="date" id="search-checkin">
          </div>
          <div class="input-group">
            <label>Check-out</label>
            <input type="date" id="search-checkout">
          </div>
        </div>
        <div class="input-row" style="grid-template-columns:1fr 1fr 1fr;">
          <div class="input-group">
            <label>Guests</label>
            <select id="search-guests" style="width:100%;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:14px;appearance:auto;">
              <option value="">Any</option>
              <option value="1">1 guest</option>
              <option value="2">2 guests</option>
              <option value="3">3 guests</option>
              <option value="4">4 guests</option>
              <option value="5">5 guests</option>
              <option value="6">6 guests</option>
              <option value="8">8+ guests</option>
            </select>
          </div>
          <div class="input-group">
            <label>Property</label>
            <select id="search-property" style="width:100%;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:14px;appearance:auto;">
              <option value="">Any type</option>
              <option value="entire_home">Entire place</option>
              <option value="private_room">Private room</option>
              <option value="hotel">Hotel</option>
            </select>
          </div>
          <div class="input-group">
            <label>Budget / night</label>
            <input type="text" id="search-budget" placeholder="$100–$300">
          </div>
        </div>
      </div>

      <!-- Category row — shown for non-travel queries -->
      <div id="generic-filters" style="display:grid;">
        <div style="display:flex;align-items:center;gap:8px;margin:8px 0 6px;">
          <span style="font-size:14px;">🛒</span>
          <span style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">Shopping Filters</span>
          <span style="font-size:10px;color:#475569;margin-left:auto;">optional — narrow your results</span>
        </div>
        <div class="input-row" style="grid-template-columns:1fr 1fr 1fr;">
          <div class="input-group">
            <label>Category</label>
            <select id="search-category" style="width:100%;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:14px;appearance:auto;">
              <option value="">Any category</option>
              <option value="Electronics">Electronics</option>
              <option value="Home & Kitchen">Home & Kitchen</option>
              <option value="Fashion">Fashion & Clothing</option>
              <option value="Sports">Sports & Outdoors</option>
              <option value="Beauty">Beauty & Personal Care</option>
              <option value="Toys">Toys & Games</option>
              <option value="Automotive">Automotive</option>
              <option value="Health">Health & Wellness</option>
              <option value="Grocery">Grocery & Gourmet</option>
              <option value="Baby">Baby & Kids</option>
              <option value="Office">Office Supplies</option>
              <option value="Tools">Tools & Home Improvement</option>
            </select>
          </div>
          <div class="input-group">
            <label>Condition</label>
            <select id="search-condition" style="width:100%;padding:10px 12px;background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:10px;color:var(--text-primary);font-size:14px;appearance:auto;">
              <option value="">Any condition</option>
              <option value="new">New</option>
              <option value="refurbished">Refurbished</option>
              <option value="used">Used</option>
            </select>
          </div>
          <div class="input-group">
            <label>Budget</label>
            <input type="text" id="search-budget-generic" placeholder="$50–$500">
          </div>
        </div>
      </div>
      <button class="go-btn" id="go-search" onclick="handleSearch()">
        <span class="btn-text">Find Best Options →</span>
        <span class="btn-spinner"></span>
      </button>
      <!-- Inventory results shown before cold search -->
      <div id="inventory-results" style="display:none; margin-top:16px;"></div>
    </div>

    <!-- Mode 3: Compare -->
    <div class="mode-panel" id="panel-compare">
      <div class="input-group">
        <label>Paste listing URLs (one per line)</label>
        <textarea id="compare-input" placeholder="https://amazon.com/dp/B09V3KXJPB&#10;https://walmart.com/ip/123456&#10;https://airbnb.com/rooms/456"></textarea>
      </div>
      <button class="go-btn" id="go-compare" onclick="handleCompare()">
        <span class="btn-text">Compare These →</span>
        <span class="btn-spinner"></span>
      </button>
    </div>
  </div>

  <div class="trust-bar">
    <div class="trust-item">
      <div class="trust-icon">🔒</div>
      <div class="trust-label">No data stored</div>
    </div>
    <div class="trust-item">
      <div class="trust-icon">⚡</div>
      <div class="trust-label">Results in seconds</div>
    </div>
    <div class="trust-item">
      <div class="trust-icon">🏷️</div>
      <div class="trust-label">26+ sites supported</div>
    </div>
    <div class="trust-item">
      <div class="trust-icon">🤖</div>
      <div class="trust-label">AI-powered scoring</div>
    </div>
  </div>
</section>

<section class="how-it-works" id="how-it-works">
  <h3>How it works</h3>
  <div class="steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-icon">🎯</div>
      <h4>Tell us your intent</h4>
      <p>Paste a link, describe what you want, or add URLs to compare.</p>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-icon">🧠</div>
      <h4>AI scores everything</h4>
      <p>We analyze price, reviews, trust, health, and 20+ signals per listing.</p>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-icon">✅</div>
      <h4>Get a clear decision</h4>
      <p>Smart Buy, Check, or Avoid — with full reasoning and alternatives.</p>
    </div>
  </div>
</section>

<section class="features">
  <h3>What you get</h3>
  <div class="feature-grid">
    <div class="feature">
      <div class="feature-icon">🏆</div>
      <h4>Decision stamps</h4>
      <p>Instant Smart Buy / Check / Avoid verdict on every product or listing.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">📊</div>
      <h4>Trust scores</h4>
      <p>Review authenticity, seller trust, and price fairness in one number.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">⚖️</div>
      <h4>Side-by-side ranking</h4>
      <p>Compare up to 20 options ranked by overall value, not just price.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">💡</div>
      <h4>Better alternatives</h4>
      <p>If something's not great, we suggest what to get instead.</p>
    </div>
  </div>
</section>

<footer>
  NirnAI — Clear decisions. Every purchase. · Not affiliated with any marketplace.
</footer>

<!-- Processing overlay -->
<div class="processing" id="processing">
  <div class="processing-spinner"></div>
  <h3 id="processing-title">Analyzing…</h3>
  <p id="processing-subtitle">Running NirnAI scoring engine</p>
  <div class="stage">
    <div class="stage-item" id="stage-fetch">⏳ Fetching listing data</div>
    <div class="stage-item" id="stage-score">⏳ Scoring & ranking</div>
    <div class="stage-item" id="stage-done">⏳ Building decision page</div>
  </div>
</div>

<div class="toast" id="toast"></div>

<script>
// ── Tab switching ──
document.querySelectorAll('.mode-tab').forEach(tab => {{
  tab.addEventListener('click', () => {{
    document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.mode-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.mode).classList.add('active');
  }});
}});

// ── Enter key ──
document.getElementById('link-input').addEventListener('keydown', e => {{
  if (e.key === 'Enter') handleLink();
}});
document.getElementById('search-input').addEventListener('keydown', e => {{
  if (e.key === 'Enter') handleSearch();
}});

// ── Travel detection for search input ──
const travelWords = ['hotel','stay','airbnb','booking','resort','hostel',
  'villa','cabin','cottage','per night','/night','guest house','check-in','checkout',
  'check in','check out','vacation rental','bed and breakfast','b&b'];
const travelCities = ['new york','nyc','tampa','miami','los angeles','chicago','seattle','boston','san francisco',
  'austin','denver','nashville','orlando','vegas','atlanta','portland','dallas','houston',
  'london','paris','tokyo','barcelona','rome','dubai','bali','cancun','hawaii','maui',
  'phoenix','san diego'];
const shoppingWords = ['phone','laptop','tv','headphone','camera','tablet','monitor','keyboard','mouse',
  'shoes','sneakers','dress','jacket','jeans','shirt','watch','ring','necklace',
  'sofa','couch','mattress','desk','chair','table','lamp','rug',
  'refrigerator','dishwasher','microwave','blender','vacuum','washer','dryer',
  'stroller','car seat','toy','game','console','playstation','xbox','nintendo',
  'best buy','amazon','walmart','target','costco','ebay'];
let travelMode = false;

function checkTravelMode() {{
  const q = document.getElementById('search-input').value.toLowerCase();
  // Empty query — no mode bias, show generic filters
  if (q.length === 0) {{
    if (travelMode) {{
      travelMode = false;
      document.getElementById('travel-filters').style.display = 'none';
      document.getElementById('generic-filters').style.display = 'grid';
    }}
    return;
  }}
  // Explicit shopping signals override travel
  const isShopping = shoppingWords.some(w => q.includes(w));
  // Travel = travel keyword or city name (but NOT if shopping word matched first)
  const isTravel = !isShopping && (travelWords.some(w => q.includes(w)) || travelCities.some(w => q.includes(w)));
  if (isTravel !== travelMode) {{
    travelMode = isTravel;
    document.getElementById('travel-filters').style.display = isTravel ? 'block' : 'none';
    document.getElementById('generic-filters').style.display = isTravel ? 'none' : 'grid';
  }}
}}

document.getElementById('search-input').addEventListener('input', checkTravelMode);
document.getElementById('search-input').addEventListener('focus', checkTravelMode);
// Initialize on load
checkTravelMode();

// ── Destination autocomplete ──
const destinations = [
  // US Major Cities
  {{ name: "New York", region: "New York, United States", icon: "📍", type: "city" }},
  {{ name: "Manhattan", region: "New York, New York, United States", icon: "📍", type: "neighborhood" }},
  {{ name: "Brooklyn", region: "New York, New York, United States", icon: "📍", type: "neighborhood" }},
  {{ name: "Manhattan Beach", region: "California, United States", icon: "📍", type: "city" }},
  {{ name: "Los Angeles", region: "California, United States", icon: "📍", type: "city" }},
  {{ name: "Hollywood", region: "Los Angeles, California, United States", icon: "📍", type: "neighborhood" }},
  {{ name: "Santa Monica", region: "California, United States", icon: "📍", type: "city" }},
  {{ name: "San Francisco", region: "California, United States", icon: "📍", type: "city" }},
  {{ name: "San Diego", region: "California, United States", icon: "📍", type: "city" }},
  {{ name: "Chicago", region: "Illinois, United States", icon: "📍", type: "city" }},
  {{ name: "Miami", region: "Florida, United States", icon: "📍", type: "city" }},
  {{ name: "Miami Beach", region: "Florida, United States", icon: "📍", type: "city" }},
  {{ name: "Tampa", region: "Florida, United States", icon: "📍", type: "city" }},
  {{ name: "Orlando", region: "Florida, United States", icon: "📍", type: "city" }},
  {{ name: "Fort Lauderdale", region: "Florida, United States", icon: "📍", type: "city" }},
  {{ name: "Key West", region: "Florida, United States", icon: "📍", type: "city" }},
  {{ name: "Seattle", region: "Washington, United States", icon: "📍", type: "city" }},
  {{ name: "Boston", region: "Massachusetts, United States", icon: "📍", type: "city" }},
  {{ name: "Austin", region: "Texas, United States", icon: "📍", type: "city" }},
  {{ name: "Dallas", region: "Texas, United States", icon: "📍", type: "city" }},
  {{ name: "Houston", region: "Texas, United States", icon: "📍", type: "city" }},
  {{ name: "San Antonio", region: "Texas, United States", icon: "📍", type: "city" }},
  {{ name: "Denver", region: "Colorado, United States", icon: "📍", type: "city" }},
  {{ name: "Nashville", region: "Tennessee, United States", icon: "📍", type: "city" }},
  {{ name: "Las Vegas", region: "Nevada, United States", icon: "📍", type: "city" }},
  {{ name: "Atlanta", region: "Georgia, United States", icon: "📍", type: "city" }},
  {{ name: "Portland", region: "Oregon, United States", icon: "📍", type: "city" }},
  {{ name: "Phoenix", region: "Arizona, United States", icon: "📍", type: "city" }},
  {{ name: "Scottsdale", region: "Arizona, United States", icon: "📍", type: "city" }},
  {{ name: "Sedona", region: "Arizona, United States", icon: "📍", type: "city" }},
  {{ name: "New Orleans", region: "Louisiana, United States", icon: "📍", type: "city" }},
  {{ name: "Washington DC", region: "District of Columbia, United States", icon: "📍", type: "city" }},
  {{ name: "Philadelphia", region: "Pennsylvania, United States", icon: "📍", type: "city" }},
  {{ name: "Savannah", region: "Georgia, United States", icon: "📍", type: "city" }},
  {{ name: "Charleston", region: "South Carolina, United States", icon: "📍", type: "city" }},
  {{ name: "Honolulu", region: "Hawaii, United States", icon: "🏝️", type: "city" }},
  {{ name: "Maui", region: "Hawaii, United States", icon: "🏝️", type: "island" }},
  {{ name: "Big Island", region: "Hawaii, United States", icon: "🏝️", type: "island" }},
  // US Vacation Spots
  {{ name: "Lake Tahoe", region: "California / Nevada, United States", icon: "🏔️", type: "region" }},
  {{ name: "Aspen", region: "Colorado, United States", icon: "🏔️", type: "city" }},
  {{ name: "Park City", region: "Utah, United States", icon: "🏔️", type: "city" }},
  {{ name: "Myrtle Beach", region: "South Carolina, United States", icon: "🏖️", type: "city" }},
  {{ name: "Outer Banks", region: "North Carolina, United States", icon: "🏖️", type: "region" }},
  {{ name: "Cape Cod", region: "Massachusetts, United States", icon: "🏖️", type: "region" }},
  {{ name: "Napa Valley", region: "California, United States", icon: "🍷", type: "region" }},
  {{ name: "Joshua Tree", region: "California, United States", icon: "🏜️", type: "region" }},
  {{ name: "Palm Springs", region: "California, United States", icon: "🌴", type: "city" }},
  // Europe
  {{ name: "London", region: "England, United Kingdom", icon: "📍", type: "city" }},
  {{ name: "Paris", region: "Île-de-France, France", icon: "📍", type: "city" }},
  {{ name: "Barcelona", region: "Catalonia, Spain", icon: "📍", type: "city" }},
  {{ name: "Madrid", region: "Spain", icon: "📍", type: "city" }},
  {{ name: "Rome", region: "Lazio, Italy", icon: "📍", type: "city" }},
  {{ name: "Florence", region: "Tuscany, Italy", icon: "📍", type: "city" }},
  {{ name: "Venice", region: "Veneto, Italy", icon: "📍", type: "city" }},
  {{ name: "Amalfi Coast", region: "Campania, Italy", icon: "🏖️", type: "region" }},
  {{ name: "Amsterdam", region: "North Holland, Netherlands", icon: "📍", type: "city" }},
  {{ name: "Berlin", region: "Germany", icon: "📍", type: "city" }},
  {{ name: "Munich", region: "Bavaria, Germany", icon: "📍", type: "city" }},
  {{ name: "Prague", region: "Czech Republic", icon: "📍", type: "city" }},
  {{ name: "Vienna", region: "Austria", icon: "📍", type: "city" }},
  {{ name: "Lisbon", region: "Portugal", icon: "📍", type: "city" }},
  {{ name: "Porto", region: "Portugal", icon: "📍", type: "city" }},
  {{ name: "Dublin", region: "Ireland", icon: "📍", type: "city" }},
  {{ name: "Edinburgh", region: "Scotland, United Kingdom", icon: "📍", type: "city" }},
  {{ name: "Santorini", region: "Greece", icon: "🏝️", type: "island" }},
  {{ name: "Mykonos", region: "Greece", icon: "🏝️", type: "island" }},
  {{ name: "Athens", region: "Greece", icon: "📍", type: "city" }},
  {{ name: "Istanbul", region: "Turkey", icon: "📍", type: "city" }},
  {{ name: "Dubrovnik", region: "Croatia", icon: "📍", type: "city" }},
  {{ name: "Reykjavik", region: "Iceland", icon: "📍", type: "city" }},
  {{ name: "Swiss Alps", region: "Switzerland", icon: "🏔️", type: "region" }},
  {{ name: "Zurich", region: "Switzerland", icon: "📍", type: "city" }},
  {{ name: "Nice", region: "French Riviera, France", icon: "🏖️", type: "city" }},
  // Asia & Pacific
  {{ name: "Tokyo", region: "Japan", icon: "📍", type: "city" }},
  {{ name: "Kyoto", region: "Japan", icon: "📍", type: "city" }},
  {{ name: "Osaka", region: "Japan", icon: "📍", type: "city" }},
  {{ name: "Bangkok", region: "Thailand", icon: "📍", type: "city" }},
  {{ name: "Phuket", region: "Thailand", icon: "🏝️", type: "island" }},
  {{ name: "Chiang Mai", region: "Thailand", icon: "📍", type: "city" }},
  {{ name: "Bali", region: "Indonesia", icon: "🏝️", type: "island" }},
  {{ name: "Singapore", region: "Singapore", icon: "📍", type: "city" }},
  {{ name: "Hong Kong", region: "China", icon: "📍", type: "city" }},
  {{ name: "Seoul", region: "South Korea", icon: "📍", type: "city" }},
  {{ name: "Dubai", region: "United Arab Emirates", icon: "📍", type: "city" }},
  {{ name: "Sydney", region: "New South Wales, Australia", icon: "📍", type: "city" }},
  {{ name: "Melbourne", region: "Victoria, Australia", icon: "📍", type: "city" }},
  {{ name: "Auckland", region: "New Zealand", icon: "📍", type: "city" }},
  // Americas
  {{ name: "Cancun", region: "Quintana Roo, Mexico", icon: "🏖️", type: "city" }},
  {{ name: "Tulum", region: "Quintana Roo, Mexico", icon: "🏖️", type: "city" }},
  {{ name: "Mexico City", region: "Mexico", icon: "📍", type: "city" }},
  {{ name: "Cabo San Lucas", region: "Baja California Sur, Mexico", icon: "🏖️", type: "city" }},
  {{ name: "Toronto", region: "Ontario, Canada", icon: "📍", type: "city" }},
  {{ name: "Vancouver", region: "British Columbia, Canada", icon: "📍", type: "city" }},
  {{ name: "Montreal", region: "Quebec, Canada", icon: "📍", type: "city" }},
  {{ name: "Banff", region: "Alberta, Canada", icon: "🏔️", type: "region" }},
  {{ name: "Rio de Janeiro", region: "Brazil", icon: "📍", type: "city" }},
  {{ name: "Buenos Aires", region: "Argentina", icon: "📍", type: "city" }},
  {{ name: "Medellín", region: "Colombia", icon: "📍", type: "city" }},
  {{ name: "San Juan", region: "Puerto Rico", icon: "🏝️", type: "city" }},
  // Africa
  {{ name: "Cape Town", region: "South Africa", icon: "📍", type: "city" }},
  {{ name: "Marrakech", region: "Morocco", icon: "📍", type: "city" }},
  // ── Shopping / Product Categories ──
  {{ name: "Laptops", region: "Electronics · Computers", icon: "💻", type: "product" }},
  {{ name: "Headphones", region: "Electronics · Audio", icon: "🎧", type: "product" }},
  {{ name: "TVs", region: "Electronics · Home Entertainment", icon: "📺", type: "product" }},
  {{ name: "Smartphones", region: "Electronics · Mobile", icon: "📱", type: "product" }},
  {{ name: "Tablets", region: "Electronics · Mobile", icon: "📱", type: "product" }},
  {{ name: "Cameras", region: "Electronics · Photography", icon: "📷", type: "product" }},
  {{ name: "Monitors", region: "Electronics · Displays", icon: "🖥️", type: "product" }},
  {{ name: "Gaming Consoles", region: "Electronics · Gaming", icon: "🎮", type: "product" }},
  {{ name: "Smartwatches", region: "Electronics · Wearables", icon: "⌚", type: "product" }},
  {{ name: "Wireless Earbuds", region: "Electronics · Audio", icon: "🎵", type: "product" }},
  {{ name: "Running Shoes", region: "Fashion · Athletic", icon: "👟", type: "product" }},
  {{ name: "Sneakers", region: "Fashion · Footwear", icon: "👟", type: "product" }},
  {{ name: "Winter Jackets", region: "Fashion · Outerwear", icon: "🧥", type: "product" }},
  {{ name: "Backpacks", region: "Fashion · Bags", icon: "🎒", type: "product" }},
  {{ name: "Sunglasses", region: "Fashion · Accessories", icon: "🕶️", type: "product" }},
  {{ name: "Mattresses", region: "Home · Bedroom", icon: "🛏️", type: "product" }},
  {{ name: "Coffee Makers", region: "Home · Kitchen Appliances", icon: "☕", type: "product" }},
  {{ name: "Air Purifiers", region: "Home · Appliances", icon: "🌬️", type: "product" }},
  {{ name: "Robot Vacuums", region: "Home · Cleaning", icon: "🤖", type: "product" }},
  {{ name: "Standing Desks", region: "Home · Office Furniture", icon: "🪑", type: "product" }},
  {{ name: "Office Chairs", region: "Home · Office Furniture", icon: "🪑", type: "product" }},
  {{ name: "Blenders", region: "Home · Kitchen Appliances", icon: "🥤", type: "product" }},
  {{ name: "Air Fryers", region: "Home · Kitchen Appliances", icon: "🍳", type: "product" }},
  {{ name: "Strollers", region: "Baby · Gear", icon: "👶", type: "product" }},
  {{ name: "Car Seats", region: "Baby · Safety", icon: "👶", type: "product" }},
  {{ name: "Protein Powder", region: "Health · Supplements", icon: "💪", type: "product" }},
  {{ name: "Vitamins", region: "Health · Supplements", icon: "💊", type: "product" }},
  {{ name: "Skincare Sets", region: "Beauty · Skincare", icon: "✨", type: "product" }},
  {{ name: "Electric Toothbrush", region: "Health · Oral Care", icon: "🪥", type: "product" }},
  {{ name: "Luggage", region: "Travel · Bags", icon: "🧳", type: "product" }},
  {{ name: "Power Tools", region: "Tools · Home Improvement", icon: "🔧", type: "product" }},
];

const acInput = document.getElementById('search-input');
const acDropdown = document.getElementById('ac-dropdown');
let acActive = -1;

function renderSuggestions(q) {{
  const lower = q.toLowerCase();
  if (lower.length < 2) {{ acDropdown.classList.remove('open'); return; }}

  const matches = destinations.filter(d =>
    d.name.toLowerCase().includes(lower) ||
    d.region.toLowerCase().includes(lower)
  ).slice(0, 8);

  if (matches.length === 0) {{ acDropdown.classList.remove('open'); return; }}

  acActive = -1;
  acDropdown.innerHTML = matches.map((d, i) => `
    <div class="ac-item" data-idx="${{i}}" data-name="${{d.name}}" data-region="${{d.region}}" data-type="${{d.type}}">
      <div class="ac-icon">${{d.icon}}</div>
      <div class="ac-text">
        <div class="ac-name">${{d.name}}</div>
        <div class="ac-region">${{d.type === 'product' ? '🛒 ' : '✈️ '}}${{d.region}}</div>
      </div>
    </div>
  `).join('');
  acDropdown.classList.add('open');
}}

acInput.addEventListener('input', () => {{ renderSuggestions(acInput.value); checkTravelMode(); }});
acInput.addEventListener('focus', () => {{ if (acInput.value.length >= 2) renderSuggestions(acInput.value); }});

acDropdown.addEventListener('click', (e) => {{
  const item = e.target.closest('.ac-item');
  if (!item) return;
  acInput.value = item.dataset.name;
  acDropdown.classList.remove('open');
  checkTravelMode();
}});

acInput.addEventListener('keydown', (e) => {{
  const items = acDropdown.querySelectorAll('.ac-item');
  if (!acDropdown.classList.contains('open') || items.length === 0) return;

  if (e.key === 'ArrowDown') {{
    e.preventDefault();
    acActive = Math.min(acActive + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle('active', i === acActive));
  }} else if (e.key === 'ArrowUp') {{
    e.preventDefault();
    acActive = Math.max(acActive - 1, 0);
    items.forEach((it, i) => it.classList.toggle('active', i === acActive));
  }} else if (e.key === 'Enter' && acActive >= 0) {{
    e.preventDefault();
    acInput.value = items[acActive].dataset.name;
    acDropdown.classList.remove('open');
    checkTravelMode();
  }} else if (e.key === 'Escape') {{
    acDropdown.classList.remove('open');
  }}
}});

document.addEventListener('click', (e) => {{
  if (!e.target.closest('.ac-wrap')) acDropdown.classList.remove('open');
}});

// ── Toast helper ──
function showToast(msg) {{
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}}

// ── Processing overlay ──
function showProcessing(title, subtitle) {{
  document.getElementById('processing-title').textContent = title;
  document.getElementById('processing-subtitle').textContent = subtitle;
  ['stage-fetch','stage-score','stage-done'].forEach(id => {{
    const el = document.getElementById(id);
    el.className = 'stage-item';
    el.textContent = '⏳ ' + el.textContent.replace(/^[^\s]+\s/, '');
  }});
  document.getElementById('processing').classList.add('active');
}}

function updateStage(id, done) {{
  const el = document.getElementById(id);
  if (done) {{
    el.className = 'stage-item done';
    el.textContent = '✓ ' + el.textContent.replace(/^[^\s]+\s/, '');
  }} else {{
    el.className = 'stage-item active';
    el.textContent = '⟳ ' + el.textContent.replace(/^[^\s]+\s/, '');
  }}
}}

function hideProcessing() {{
  document.getElementById('processing').classList.remove('active');
}}

function setLoading(btnId, loading) {{
  const btn = document.getElementById(btnId);
  if (loading) {{ btn.classList.add('loading'); btn.disabled = true; }}
  else {{ btn.classList.remove('loading'); btn.disabled = false; }}
}}

// ── MODE 1: Paste link → analyze single product ──
async function handleLink() {{
  const url = document.getElementById('link-input').value.trim();
  if (!url) return showToast('Paste a product or listing URL');
  if (!url.startsWith('http')) return showToast('Enter a valid URL starting with http');

  setLoading('go-link', true);
  showProcessing('Analyzing link…', url.length > 60 ? url.slice(0, 60) + '…' : url);
  updateStage('stage-fetch', false);

  try {{
    // Send to /intent/link — server will scrape, score, and redirect
    const resp = await fetch('/intent/link', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ url }})
    }});
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Analysis failed');

    updateStage('stage-fetch', true);
    updateStage('stage-score', false);

    // If we got a compare session, poll it
    if (data.compare_url) {{
      updateStage('stage-score', true);
      updateStage('stage-done', false);
      // Redirect to the decision page
      setTimeout(() => {{
        updateStage('stage-done', true);
        window.location.href = data.compare_url;
      }}, 500);
    }} else if (data.result) {{
      // Single product result — redirect to a result page
      updateStage('stage-score', true);
      updateStage('stage-done', true);
      window.location.href = data.result_url || '/';
    }}
  }} catch (err) {{
    hideProcessing();
    showToast(err.message);
  }} finally {{
    setLoading('go-link', false);
  }}
}}

// ── MODE 2: Search ──
async function handleSearch() {{
  const query = document.getElementById('search-input').value.trim();
  if (!query) return showToast('Describe what you\'re looking for');

  // Collect filters based on current mode
  let category = '';
  let budget = '';
  let checkin = '';
  let checkout = '';
  let guests = '';
  let propertyType = '';

  if (travelMode) {{
    checkin = document.getElementById('search-checkin').value || '';
    checkout = document.getElementById('search-checkout').value || '';
    guests = document.getElementById('search-guests').value || '';
    propertyType = document.getElementById('search-property').value || '';
    budget = document.getElementById('search-budget').value.trim();
    category = 'travel';
  }} else {{
    category = document.getElementById('search-category').value.trim();
    budget = document.getElementById('search-budget-generic').value.trim();
  }}

  setLoading('go-search', true);

  // Fetch both inventory results AND platform search links in parallel
  let invData = null;
  let guideData = null;

  // Step 1: Check inventory for pre-ranked results
  try {{
    const invResp = await fetch('/listings/search?destination=' + encodeURIComponent(query) + '&limit=10');
    if (invResp.ok) {{
      const d = await invResp.json();
      if (d.listings && d.listings.length > 0) invData = d;
    }}
  }} catch (_) {{}}

  // Step 2: Always get platform search links (with filters applied)
  try {{
    const resp = await fetch('/intent/search', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ query, category, budget, checkin, checkout, guests, property_type: propertyType }})
    }});
    const data = await resp.json();
    if (resp.ok && data.result && data.result.type === 'search_guide') {{
      guideData = data.result;
    }}
  }} catch (_) {{}}

  setLoading('go-search', false);

  // Step 3: Render combined results
  const container = document.getElementById('inventory-results');
  let html = '';

  if (invData) {{
    html += buildInventoryHTML(invData, query, checkin, checkout, guests);
  }}

  if (guideData) {{
    const hasInv = !!invData;
    html += buildSearchGuideHTML(guideData, query, hasInv, checkin, checkout, guests);
  }}

  if (html) {{
    container.innerHTML = html;
    container.style.display = 'block';
  }} else {{
    showToast('No results found. Try a different search.');
  }}
}}

// Affiliate / monetization: append tracking + affiliate params to outbound URLs
function affiliateUrl(url) {{
  try {{
    const u = new URL(url);
    const h = u.hostname.toLowerCase();
    const AFF = {{
      booking:     '{booking_aff}',
      amazon:      '{amazon_aff}',
      expedia:     '{expedia_aff}',
      'hotels.com':'{hotels_aff}',
      ebay:        '{ebay_aff}',
      vrbo:        '{vrbo_aff}',
      tripadvisor: '{tripadvisor_aff}',
    }};
    if (h.includes('booking') && AFF.booking)     u.searchParams.set('aid', AFF.booking);
    if (h.includes('amazon') && AFF.amazon)        u.searchParams.set('tag', AFF.amazon);
    if (h.includes('expedia') && AFF.expedia)      u.searchParams.set('affcid', AFF.expedia);
    if (h.includes('hotels.com') && AFF['hotels.com']) u.searchParams.set('rffrid', AFF['hotels.com']);
    if (h.includes('ebay') && AFF.ebay) {{
      u.searchParams.set('campid', AFF.ebay);
      u.searchParams.set('toolid', '10001');
      u.searchParams.set('customid', 'nirnai');
    }}
    if (h.includes('vrbo') && AFF.vrbo)            u.searchParams.set('affid', AFF.vrbo);
    if (h.includes('tripadvisor') && AFF.tripadvisor) u.searchParams.set('CampaignId', AFF.tripadvisor);
    u.searchParams.set('utm_source', 'nirnai');
    u.searchParams.set('utm_medium', 'referral');
    return u.toString();
  }} catch {{ return url; }}
}}

function buildInventoryHTML(data, query, checkin, checkout, guests) {{
  const decisionClass = (d) => {{
    const dl = d.toLowerCase();
    if (dl.includes('book') || dl.includes('smart') || dl.includes('buy')) return 'book';
    if (dl.includes('skip') || dl.includes('avoid')) return 'skip';
    return 'think';
  }};

  // Build date/guest suffix for booking links
  const dateInfo = [];
  if (checkin) dateInfo.push(checkin);
  if (checkout) dateInfo.push(checkout);
  const dateLabel = dateInfo.length === 2 ? `${{checkin}} → ${{checkout}}` : (dateInfo.length === 1 ? dateInfo[0] : '');
  const guestsLabel = guests ? `${{guests}} guest${{guests > 1 ? 's' : ''}}` : '';
  const filterSummary = [dateLabel, guestsLabel].filter(Boolean).join(' · ');

  // Detect if this is travel or shopping based on listing platforms
  const isTravelResult = data.listings.some(l => {{
    const p = (l.platform || '').toLowerCase();
    return ['airbnb','booking','expedia','vrbo','hotels','tripadvisor'].some(s => p.includes(s));
  }});

  let html = `
    <div class="inv-header">
      <h4>🛡️ NirnAI-verified ${{isTravelResult ? 'stays in' : 'results for'}} ${{query}}</h4>
      <span class="inv-badge">FROM INVENTORY</span>
    </div>`;

  if (filterSummary) {{
    html += `<div style="font-size:12px;color:#f59e0b;margin:-4px 0 10px 0;">📅 ${{filterSummary}} — check availability on each listing</div>`;
  }}

  data.listings.forEach(l => {{
    // Determine if this listing is from a travel platform
    const plat = (l.platform || '').toLowerCase();
    const isTravel = ['airbnb','booking','expedia','vrbo','hotels','tripadvisor'].some(s => plat.includes(s));

    // Append date/guest params to the booking URL so user lands on correct dates
    let bookingLink = l.url || (isTravel
      ? `https://www.${{l.platform || 'airbnb'}}.com/s/${{encodeURIComponent(query)}}/homes`
      : `https://www.${{l.platform || 'amazon'}}.com/s?k=${{encodeURIComponent(query)}}`);
    if (l.url) {{
      const sep = l.url.includes('?') ? '&' : '?';
      const params = [];
      if (checkin) {{
        if (l.url.includes('airbnb')) {{ params.push('check_in=' + checkin); }}
        else if (l.url.includes('booking')) {{ params.push('checkin=' + checkin); }}
      }}
      if (checkout) {{
        if (l.url.includes('airbnb')) {{ params.push('check_out=' + checkout); }}
        else if (l.url.includes('booking')) {{ params.push('checkout=' + checkout); }}
      }}
      if (guests) {{
        if (l.url.includes('airbnb')) {{ params.push('adults=' + guests); }}
        else if (l.url.includes('booking')) {{ params.push('group_adults=' + guests); }}
      }}
      if (params.length) bookingLink = l.url + sep + params.join('&');
    }}
    bookingLink = affiliateUrl(bookingLink);
    // Context-aware CTA: travel = "Check Availability", shopping = "View Deal"
    let linkLabel;
    if (l.url) {{
      linkLabel = isTravel ? 'Check Availability →' : 'View Deal →';
    }} else {{
      const pName = (l.platform || (isTravel ? 'airbnb' : 'amazon'));
      linkLabel = `Search on ${{pName.charAt(0).toUpperCase() + pName.slice(1)}} →`;
    }}
    html += `
      <div class="inv-card">
        <div class="rank">#${{l.rank}}</div>
        ${{l.image_url ? `<img src="${{l.image_url}}" class="inv-thumb" alt="" />` : ''}}
        <div class="info">
          <div class="title">${{l.title}}</div>
          <div class="meta">${{l.platform}} · Score: ${{l.purchase_score}}/100 · ${{l.confidence_tier}} confidence</div>
          <span class="score ${{decisionClass(l.decision)}}">${{l.decision}}</span>
          <div style="margin-top:4px;font-size:11px;color:#94a3b8;">${{l.why_ranked}}</div>
          <a href="${{bookingLink}}" target="_blank" rel="noopener" class="inv-cta">${{linkLabel}}</a>
        </div>
        <div class="price-tag">${{l.price}}</div>
      </div>`;
  }});

  html += `<div class="inv-fresh">${{data.freshness_note}}</div>`;
  return html;
}}

function buildSearchGuideHTML(guide, query, hasInventory, checkin, checkout, guests) {{
  const cat = guide.category === 'travel' ? '🏠' : '🛒';
  const heading = hasInventory
    ? 'Browse more options on these platforms'
    : `Search: ${{query}}`;
  const subtext = hasInventory
    ? `Check prices and availability${{checkin ? ' for your dates' : ''}} across platforms. Install the <strong style="color:#f59e0b;">NirnAI extension</strong> to get automatic rankings.`
    : `No NirnAI-verified results for this search yet. Browse any of these platforms with the <strong style="color:#f59e0b;">NirnAI extension</strong> installed — it will automatically extract listings, search across all platforms, and rank the best options for you.`;

  let html = `
    <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:24px; margin-top:${{hasInventory ? '20' : '12'}}px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
        <span style="font-size:24px;">${{cat}}</span>
        <h4 style="color:#f1f5f9; margin:0; font-size:16px;">${{heading}}</h4>
      </div>
      <p style="color:#94a3b8; font-size:13px; margin:4px 0 16px 0;">
        ${{subtext}}
      </p>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">`;

  guide.platform_links.forEach(link => {{
    const affLink = affiliateUrl(link.url);
    html += `
        <a href="${{affLink}}" target="_blank" rel="noopener"
           style="display:flex; align-items:center; gap:10px; padding:12px 16px;
                  background:#0f172a; border:1px solid #334155; border-radius:8px;
                  color:#e2e8f0; text-decoration:none; transition:all 0.2s;"
           onmouseover="this.style.borderColor='#f59e0b'; this.style.background='#1a2332';"
           onmouseout="this.style.borderColor='#334155'; this.style.background='#0f172a';">
          <span style="font-size:20px;">${{link.icon}}</span>
          <div>
            <div style="font-weight:600; font-size:13px;">${{link.platform}}</div>
            <div style="font-size:11px; color:#64748b;">Search here →</div>
          </div>
        </a>`;
  }});

  html += `
      </div>`;

  if (!hasInventory) {{
    html += `
      <div style="margin-top:16px; padding:12px 16px; background:#0c1322; border:1px solid #1e3a5f;
                  border-radius:8px; display:flex; align-items:flex-start; gap:10px;">
        <span style="font-size:18px;">💡</span>
        <div style="font-size:12px; color:#94a3b8; line-height:1.5;">
          <strong style="color:#60a5fa;">How it works:</strong> Visit any listing on these platforms.
          The NirnAI extension will analyze it, automatically find alternatives across all platforms,
          and rank them so you get the best deal with full confidence.
          <br><br>
          <strong style="color:#60a5fa;">Don't have the extension?</strong>
          <a href="https://chromewebstore.google.com" target="_blank" rel="noopener"
             style="color:#f59e0b; text-decoration:underline;">Install NirnAI for Chrome</a>
          to unlock live cross-platform rankings.
        </div>
      </div>`;
  }}

  html += `</div>`;
  return html;
}}

// ── MODE 3: Compare URLs ──
async function handleCompare() {{
  const raw = document.getElementById('compare-input').value.trim();
  if (!raw) return showToast('Paste at least 2 listing URLs');

  const urls = raw.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
  if (urls.length < 2) return showToast('Need at least 2 valid URLs to compare');
  if (urls.length > 20) return showToast('Maximum 20 URLs');

  setLoading('go-compare', true);
  showProcessing('Comparing ' + urls.length + ' listings…', 'Fetching data from each URL');
  updateStage('stage-fetch', false);

  try {{
    const resp = await fetch('/intent/compare', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ urls }})
    }});
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Comparison failed');

    updateStage('stage-fetch', true);
    updateStage('stage-score', true);
    updateStage('stage-done', true);

    if (data.compare_url) {{
      window.location.href = data.compare_url;
    }}
  }} catch (err) {{
    hideProcessing();
    showToast(err.message);
  }} finally {{
    setLoading('go-compare', false);
  }}
}}
</script>
</body>
</html>"##,
        booking_aff = std::env::var("NIRNAI_AFF_BOOKING").unwrap_or_default(),
        amazon_aff = std::env::var("NIRNAI_AFF_AMAZON").unwrap_or_default(),
        expedia_aff = std::env::var("NIRNAI_AFF_EXPEDIA").unwrap_or_default(),
        hotels_aff = std::env::var("NIRNAI_AFF_HOTELS").unwrap_or_default(),
        ebay_aff = std::env::var("NIRNAI_AFF_EBAY").unwrap_or_default(),
        vrbo_aff = std::env::var("NIRNAI_AFF_VRBO").unwrap_or_default(),
        tripadvisor_aff = std::env::var("NIRNAI_AFF_TRIPADVISOR").unwrap_or_default(),
    )
}
