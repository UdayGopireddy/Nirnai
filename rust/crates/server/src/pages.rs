use axum::http::header;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse};

/// GET /privacy — Privacy policy page
pub async fn privacy() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(build_privacy_html()),
    )
}

/// GET /support — Support / contact page
pub async fn support() -> impl IntoResponse {
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        Html(build_support_html()),
    )
}

fn page_shell(title: &str, body: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} — NirnAI</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>">
<style>
:root {{
  --bg-page: #06080f;
  --bg-card: #0c1017;
  --bg-raised: #111827;
  --border-subtle: #1e293b;
  --accent: #818cf8;
  --accent-strong: #6366f1;
  --text-primary: #f1f5f9;
  --text-secondary: #94a3b8;
  --text-muted: #475569;
}}
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  background: var(--bg-page);
  color: var(--text-primary);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}}
.header {{
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-subtle);
  padding: 14px 24px;
  display: flex; align-items: center; gap: 10px;
  position: sticky; top: 0; z-index: 100;
  backdrop-filter: blur(12px);
}}
.header .logo {{ font-size: 22px; }}
.header .brand {{
  font-size: 18px; font-weight: 800;
  background: linear-gradient(135deg, var(--accent), #a78bfa);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}}
.header .tagline {{
  font-size: 11px; color: var(--text-muted); margin-left: auto;
  letter-spacing: 0.3px;
}}
.container {{
  max-width: 720px; margin: 0 auto; padding: 48px 24px 80px;
}}
h1 {{
  font-size: 28px; font-weight: 800; margin-bottom: 8px;
  background: linear-gradient(135deg, var(--text-primary), var(--accent));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}}
.updated {{
  font-size: 12px; color: var(--text-muted); margin-bottom: 32px;
}}
h2 {{
  font-size: 18px; font-weight: 700; color: var(--text-primary);
  margin-top: 36px; margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border-subtle);
}}
h3 {{
  font-size: 15px; font-weight: 700; color: var(--text-secondary);
  margin-top: 24px; margin-bottom: 8px;
}}
p, li {{
  font-size: 14px; line-height: 1.7; color: var(--text-secondary);
  margin-bottom: 12px;
}}
ul {{ padding-left: 20px; margin-bottom: 16px; }}
li {{ margin-bottom: 6px; }}
a {{ color: var(--accent); text-decoration: none; }}
a:hover {{ text-decoration: underline; }}
.card {{
  background: var(--bg-card);
  border: 1px solid var(--border-subtle);
  border-radius: 14px;
  padding: 24px;
  margin-top: 24px;
}}
.footer {{
  text-align: center; padding: 36px 0 16px;
  font-size: 11px; color: var(--text-muted);
}}
@media (max-width: 600px) {{
  .container {{ padding: 28px 16px 60px; }}
  h1 {{ font-size: 22px; }}
  .header .tagline {{ display: none; }}
}}
</style>
</head>
<body>
  <div class="header">
    <a href="/" style="display:flex;align-items:center;gap:10px;text-decoration:none;">
      <span class="logo">🛡️</span>
      <span class="brand">NirnAI</span>
    </a>
    <span class="tagline">Clear decisions. Every purchase.</span>
  </div>
  <div class="container">
    {body}
  </div>
  <div class="footer">🛡️ NirnAI — Clear decisions. Every purchase.<br><a href="/privacy" style="color:#7eb8da;text-decoration:none;font-size:11px;">Privacy Policy</a> · <a href="/support" style="color:#7eb8da;text-decoration:none;font-size:11px;">Support</a><br><span style="font-size:9px;opacity:0.6;">As an Amazon Associate and affiliate partner, NirnAI earns from qualifying purchases.</span></div>
</body>
</html>"##,
        title = title,
        body = body,
    )
}

fn build_privacy_html() -> String {
    page_shell("Privacy Policy", r#"
    <h1>Privacy Policy</h1>
    <p class="updated">Last updated: April 13, 2026</p>

    <p>NirnAI ("we", "our", or "us") operates the NirnAI Chrome extension and the nirnai.app website. This Privacy Policy explains what data we collect, how we use it, and your rights.</p>

    <h2>1. Data We Collect</h2>

    <h3>Product &amp; Listing Data</h3>
    <p>When you visit a supported shopping or travel site, the extension extracts publicly visible product information from the page:</p>
    <ul>
      <li>Product title, price, ratings, and review count</li>
      <li>Seller or host name</li>
      <li>Delivery and return policy details</li>
      <li>Product URL</li>
    </ul>
    <p>This data is sent to our backend API for analysis and scoring. <strong>We do not store this data beyond the duration of the analysis request</strong> (typically a few seconds).</p>

    <h3>Comparison Sessions</h3>
    <p>When you use the cross-site comparison feature on nirnai.app, listing data is stored temporarily in a session for up to 24 hours so you can share and revisit the comparison page. Sessions are automatically deleted after expiration.</p>

    <h3>Click Data</h3>
    <p>When you click an outbound link on a comparison page, we record the click event (session ID, platform, listing rank, and whether it was an affiliate link). This is used solely for aggregate analytics. No personally identifiable information is collected.</p>

    <h3>What We Do NOT Collect</h3>
    <ul>
      <li>No personal information (name, email, address, phone number)</li>
      <li>No browsing history or activity on non-supported sites</li>
      <li>No authentication credentials or passwords</li>
      <li>No financial or payment information</li>
      <li>No location data</li>
      <li>No cookies or cross-site tracking</li>
    </ul>

    <h2>2. How We Use Data</h2>
    <ul>
      <li><strong>Product analysis:</strong> Extracted product data is sent to our API, scored, and returned as a recommendation. Data is not persisted.</li>
      <li><strong>Comparison sessions:</strong> Temporarily stored (24 hours) to power shareable comparison pages.</li>
      <li><strong>Click analytics:</strong> Aggregate, anonymized click data to understand which platforms users prefer. No individual tracking.</li>
      <li><strong>Affiliate links:</strong> Some outbound links include affiliate parameters (e.g., Booking.com via Awin). This does not affect rankings or recommendations.</li>
    </ul>

    <h2>3. Data Storage &amp; Security</h2>
    <ul>
      <li>All API communication uses HTTPS/TLS encryption.</li>
      <li>Backend services run on AWS App Runner with managed infrastructure security.</li>
      <li>Temporary data (sessions, clicks) is stored in AWS DynamoDB with automatic TTL-based expiration.</li>
      <li>No user data is sold, shared with third parties, or used for advertising.</li>
    </ul>

    <h2>4. Third-Party Services</h2>
    <ul>
      <li><strong>OpenAI:</strong> Product data may be sent to OpenAI's API for AI-powered analysis summaries. OpenAI's data usage policy applies.</li>
      <li><strong>AWS:</strong> Infrastructure hosting (App Runner, DynamoDB). Data resides in the US East (N. Virginia) region.</li>
      <li><strong>Awin:</strong> Affiliate link tracking for Booking.com. Awin may set cookies on the destination site, subject to their own privacy policy.</li>
      <li><strong>Amazon Associates:</strong> As an Amazon Associate, NirnAI earns from qualifying purchases. Amazon may set cookies when you click affiliate links.</li>
      <li><strong>Impact.com:</strong> Affiliate tracking for retail partners (Walmart, Target, Airbnb). Impact may set cookies on destination sites.</li>
    </ul>

    <h2>5. Chrome Extension Permissions</h2>
    <p>The extension requests the following permissions:</p>
    <ul>
      <li><strong>storage:</strong> Cache analysis results locally (expires after 30 minutes)</li>
      <li><strong>activeTab:</strong> Read product information from the current tab</li>
      <li><strong>scripting:</strong> Inject the analysis panel into supported pages</li>
      <li><strong>tabs:</strong> Detect navigation to supported sites and open comparison pages</li>
      <li><strong>host_permissions:</strong> Access specific shopping and travel sites to extract product data</li>
    </ul>

    <h2>6. Your Rights</h2>
    <ul>
      <li>You can uninstall the extension at any time to stop all data collection.</li>
      <li>Comparison sessions expire automatically after 24 hours.</li>
      <li>No account or registration is required to use NirnAI.</li>
      <li>To request deletion of any data or ask questions, contact us at the email below.</li>
    </ul>

    <h2>7. Children's Privacy</h2>
    <p>NirnAI is not directed at children under 13 and does not knowingly collect any personal information from children.</p>

    <h2>8. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated date.</p>

    <h2>9. Contact</h2>
    <div class="card">
      <p><strong>NirnAI</strong></p>
      <p>Email: <a href="mailto:mailtoudayz@gmail.com">mailtoudayz@gmail.com</a></p>
      <p>Website: <a href="https://nirnai.app">nirnai.app</a></p>
    </div>
    "#)
}

fn build_support_html() -> String {
    page_shell("Support", r#"
    <h1>Support</h1>
    <p class="updated">NirnAI — we're here to help.</p>

    <h2>Contact Us</h2>
    <div class="card">
      <p>For questions, bug reports, or feedback:</p>
      <p style="margin-top:12px;"><strong>Email:</strong> <a href="mailto:mailtoudayz@gmail.com">mailtoudayz@gmail.com</a></p>
      <p><strong>Website:</strong> <a href="https://nirnai.app">nirnai.app</a></p>
    </div>

    <h2>Frequently Asked Questions</h2>

    <h3>What is NirnAI?</h3>
    <p>NirnAI is an AI-powered shopping and travel assistant that analyzes products and accommodations across 20+ sites, giving you a clear buy/don't-buy recommendation based on ratings, reviews, price fairness, and seller trust.</p>

    <h3>How does it work?</h3>
    <p>The Chrome extension automatically activates on supported sites (Amazon, Walmart, Booking.com, Airbnb, etc.). It reads publicly visible product information from the page, sends it to our AI analysis engine, and shows you a verdict — all in seconds.</p>

    <h3>Which sites are supported?</h3>
    <p><strong>Shopping:</strong> Amazon, Walmart, Target, Costco, Best Buy, Home Depot, Lowe's, eBay, Wayfair, Macy's, Nordstrom, Nike, Apple, Samsung, Dyson, CVS, Walgreens</p>
    <p><strong>Travel:</strong> Booking.com, Airbnb, Expedia, VRBO, Agoda, Hotels.com, TripAdvisor, Google Travel</p>

    <h3>Is my data safe?</h3>
    <p>Yes. We only process publicly visible product data for analysis. We don't collect personal information, browsing history, or passwords. Analysis data is not stored beyond the request. Read our full <a href="/privacy">Privacy Policy</a>.</p>

    <h3>What do the verdicts mean?</h3>
    <ul>
      <li>🟢 <strong>Smart Buy / Book It</strong> — High quality, fair price, trusted seller</li>
      <li>🟡 <strong>Think About It</strong> — Decent but has some concerns worth considering</li>
      <li>🔴 <strong>Don't Buy / Skip</strong> — Significant issues with quality, price, or trust</li>
    </ul>

    <h3>How does cross-site comparison work?</h3>
    <p>Search for a destination on <a href="https://nirnai.app">nirnai.app</a> and NirnAI scrapes listings from multiple travel platforms (Booking.com, Airbnb, Expedia, etc.), scores them using the same AI engine, and ranks them so you can find the best deal.</p>

    <h3>Does NirnAI use affiliate links?</h3>
    <p>Some outbound links on comparison pages include affiliate parameters (e.g., Booking.com via Awin). This helps support NirnAI but <strong>does not affect rankings or recommendations</strong>. All rankings are determined solely by our scoring algorithm.</p>

    <h3>The extension isn't showing up on a page</h3>
    <ul>
      <li>Make sure you're on a supported site (see list above)</li>
      <li>Make sure you're on a product/listing page, not a search results page</li>
      <li>Try refreshing the page</li>
      <li>Check that the extension is enabled in <code>chrome://extensions</code></li>
    </ul>

    <h3>How do I uninstall?</h3>
    <p>Right-click the NirnAI icon in your browser toolbar and select "Remove from Chrome", or go to <code>chrome://extensions</code> and click Remove.</p>

    <h2>Report a Bug</h2>
    <div class="card">
      <p>Found something broken? Please email us with:</p>
      <ul>
        <li>The URL of the page where the issue occurred</li>
        <li>What you expected to happen</li>
        <li>What actually happened</li>
        <li>A screenshot if possible</li>
      </ul>
      <p style="margin-top:12px;"><a href="mailto:mailtoudayz@gmail.com?subject=NirnAI%20Bug%20Report">Send Bug Report →</a></p>
    </div>
    "#)
}
