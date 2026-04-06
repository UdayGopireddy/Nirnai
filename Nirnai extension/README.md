# NirnAI — Clear decisions. Every purchase. 🛡️

**उत्पाद मूल्यांकन एवं निर्णय**

AI-powered Chrome extension that helps you make smarter purchase decisions by analyzing product quality, price fairness, seller trust, and health impact.

## Features

- **Purchase Score (0-100)** — Reviews, price, seller trust, returns, popularity, specs, delivery
- **Health Score (0-100)** — Nutrition, ingredients safety, processing level (food products)
- **BUY / NEUTRAL / DON'T BUY** — Clear decision based on scoring thresholds
- **AI Summary** — GPT-powered insights on every product

## Project Structure

```
nirnai/
├── extension/               # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── src/
│   │   ├── types.ts         # Shared types
│   │   ├── content/         # Content script (Amazon DOM extraction)
│   │   ├── background/      # Service worker (API calls, caching)
│   │   └── popup/           # Extension popup UI
│   └── dist/                # Compiled JS (generated)
├── backend/                 # FastAPI Backend
│   ├── main.py              # API server
│   ├── models.py            # Pydantic models
│   ├── purchase_scoring.py  # Purchase score engine
│   ├── health_scoring.py    # Health score engine
│   └── ai_service.py        # OpenAI integration
└── ai_shopping_health_copilot_prd.md
```

## Getting Started

### 1. Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your OPENAI_API_KEY

# Start server
uvicorn main:app --reload --port 8000
```

### 2. Extension Setup

```bash
cd extension
npm install
npm run build
```

### 3. Load Extension in Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. Navigate to any Amazon product page

## API

### POST /analyze

```json
// Request
{
  "title": "Product Name",
  "price": "₹599",
  "rating": "4.2 out of 5 stars",
  "reviewCount": "1,234 ratings",
  "seller": "SellerName",
  "ingredients": "...",
  "nutritionInfo": "..."
}

// Response
{
  "purchase_score": 78,
  "health_score": 62,
  "decision": "NEUTRAL",
  "purchase_breakdown": { "reviews": 80, "price": 65, ... },
  "health_breakdown": { "nutrition": 55, "ingredients": 70, "processing": 65 },
  "summary": "AI-generated analysis summary..."
}
```

## Decision Logic

| Condition | Decision |
|-----------|----------|
| Health Score < 40 | DON'T BUY |
| Purchase > 80 & Health > 70 | BUY |
| Purchase < 50 | DON'T BUY |
| Otherwise | NEUTRAL |

## Tech Stack

- **Extension**: Chrome Manifest V3, TypeScript
- **Backend**: Python, FastAPI
- **AI**: OpenAI GPT-4o-mini
