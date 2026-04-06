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
      <div class="input-group">
        <label>What are you looking for?</label>
        <input type="text" id="search-input" placeholder="Best 2BR in Tampa under $200/night" autocomplete="off">
      </div>
      <div class="input-row">
        <div class="input-group">
          <label>Category</label>
          <input type="text" id="search-category" placeholder="Travel, Electronics…">
        </div>
        <div class="input-group">
          <label>Budget</label>
          <input type="text" id="search-budget" placeholder="$100–$300">
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
        <textarea id="compare-input" placeholder="https://airbnb.com/rooms/123&#10;https://booking.com/hotel/xyz&#10;https://vrbo.com/456"></textarea>
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

  const category = document.getElementById('search-category').value.trim();
  const budget = document.getElementById('search-budget').value.trim();

  setLoading('go-search', true);

  // Step 1: Check inventory for pre-ranked results
  try {{
    const invResp = await fetch('/listings/search?destination=' + encodeURIComponent(query) + '&limit=10');
    if (invResp.ok) {{
      const invData = await invResp.json();
      if (invData.listings && invData.listings.length > 0) {{
        showInventoryResults(invData, query);
        setLoading('go-search', false);
        return;
      }}
    }}
  }} catch (_) {{
    // Inventory check failed — fall through to live search
  }}

  // Step 2: No inventory results — get platform search links
  showProcessing('Searching…', query);
  updateStage('stage-fetch', false);

  try {{
    const resp = await fetch('/intent/search', {{
      method: 'POST',
      headers: {{ 'Content-Type': 'application/json' }},
      body: JSON.stringify({{ query, category, budget }})
    }});
    const data = await resp.json();

    if (!resp.ok) throw new Error(data.error || 'Search failed');

    hideProcessing();

    // Handle search guide response (platform links)
    if (data.result && data.result.type === 'search_guide') {{
      showSearchGuide(data.result, query);
      return;
    }}

    // Legacy: if compare_url is returned, redirect
    if (data.compare_url) {{
      updateStage('stage-fetch', true);
      updateStage('stage-score', true);
      updateStage('stage-done', true);
      window.location.href = data.compare_url;
    }}
  }} catch (err) {{
    hideProcessing();
    showToast(err.message);
  }} finally {{
    setLoading('go-search', false);
  }}
}}

function showInventoryResults(data, query) {{
  const container = document.getElementById('inventory-results');
  const decisionClass = (d) => {{
    const dl = d.toLowerCase();
    if (dl.includes('book') || dl.includes('smart') || dl.includes('buy')) return 'book';
    if (dl.includes('skip') || dl.includes('avoid')) return 'skip';
    return 'think';
  }};

  let html = `
    <div class="inv-header">
      <h4>🛡️ NirnAI-verified stays in ${{query}}</h4>
      <span class="inv-badge">FROM INVENTORY</span>
    </div>`;

  data.listings.forEach(l => {{
    const bookingLink = l.url
      ? l.url
      : `https://www.${{l.platform || 'airbnb'}}.com/s/${{encodeURIComponent(query)}}/homes`;
    const linkLabel = l.url ? 'Book Now →' : `Search on ${{(l.platform || 'airbnb').charAt(0).toUpperCase() + (l.platform || 'airbnb').slice(1)}} →`;
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
  html += `<div class="inv-divider">Want fresher results?</div>`;

  container.innerHTML = html;
  container.style.display = 'block';
}}

function showSearchGuide(guide, query) {{
  const container = document.getElementById('inventory-results');
  const cat = guide.category === 'travel' ? '🏠' : '🛒';
  const catLabel = guide.category === 'travel' ? 'Travel & Stays' : 'Shopping';

  let html = `
    <div style="background:#1e293b; border:1px solid #334155; border-radius:12px; padding:24px; margin-top:12px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
        <span style="font-size:24px;">${{cat}}</span>
        <h4 style="color:#f1f5f9; margin:0; font-size:16px;">Search: ${{query}}</h4>
      </div>
      <p style="color:#94a3b8; font-size:13px; margin:4px 0 16px 0;">
        No NirnAI-verified results for this search yet. Browse any of these platforms with the
        <strong style="color:#f59e0b;">NirnAI extension</strong> installed — it will automatically
        extract listings, search across all platforms, and rank the best options for you.
      </p>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap:10px;">`;

  guide.platform_links.forEach(link => {{
    html += `
        <a href="${{link.url}}" target="_blank" rel="noopener"
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
      </div>
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
      </div>
    </div>`;

  container.innerHTML = html;
  container.style.display = 'block';
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
</html>"##
    )
}
