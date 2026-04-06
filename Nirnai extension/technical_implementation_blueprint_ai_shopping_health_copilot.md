# Technical Implementation Blueprint
## AI Shopping + Health Copilot App

---

## 1. Objective

Build a product that analyzes items during online shopping and provides:

- **Purchase Verdict**: Buy / Neutral / Don’t Buy
- **Health Score** for packaged foods
- **Transparent reasons** for the recommendation

The MVP should work without depending on Yuka or Honey integrations.

---

## 2. Product Form

### Recommended MVP
**Chrome Extension + Backend API**

Why:
- Works directly in the shopping flow
- No retailer partnership required
- Fastest path to proving value
- Easier than launching a full consumer app first

### Later Expansions
- Mobile app with barcode scanner
- Web dashboard for saved products and health preferences
- Price history and alternative recommendations

---

## 3. High-Level Architecture

```text
[Shopping Website]
      |
      v
[Chrome Extension]
  - Content Script
  - Service Worker
  - Side Panel / Widget
      |
      v
[Backend API - FastAPI]
  - Product Parser
  - Purchase Scoring Engine
  - Health Scoring Engine
  - Explanation Generator
      |
      +--> [Open Food Facts Lookup]
      |
      +--> [USDA FoodData Central Lookup]
      |
      +--> [LLM for extraction cleanup + explanation]
```

---

## 4. Core User Flow

### Product Page Flow
1. User opens a product page.
2. Extension detects the page type.
3. Extension extracts product data from the DOM.
4. Extension sends a structured payload to the backend.
5. Backend computes:
   - purchase score
   - health score, if applicable
   - final verdict
6. Extension displays the result in a widget or side panel.

### Cart Flow
1. User adds item to cart or opens cart.
2. Extension detects cart-related DOM changes.
3. Each visible cart item is extracted and analyzed.
4. The extension shows:
   - per-item score
   - overall cart summary
   - riskiest or healthiest item signals

---

## 5. Why You Do Not Need Yuka or Honey APIs

### Yuka
Yuka is better treated as a **product reference / competitor**, not a required dependency.
Your app should own:
- nutrition scoring
- ingredient logic
- health verdict rules

### Honey
Honey is mainly about:
- coupons
- cashback
- price comparisons

Your product is about:
- product quality
- health intelligence
- final decision support

### Recommended Data Strategy Instead
Use:
1. Product page extraction
2. Open Food Facts lookup
3. USDA FoodData Central lookup
4. Your own scoring engine

That makes the system:
- independent
- more defensible
- easier to improve over time

---

## 6. Data Sources

### Primary Source: Merchant Product Page
Extract directly from the page:

- title
- brand
- price
- seller
- rating
- review count
- return policy
- delivery info
- ingredients
- nutrition facts
- barcode / UPC if present

### Secondary Source: Open Food Facts
Use as a fallback or enrichment source when:
- barcode is available
- nutrition data is missing
- ingredients are incomplete
- additives or processing clues are needed

Useful fields:
- product name
- brands
- ingredients text
- nutrition values
- NOVA / processing indicators if available
- labels/tags

### Tertiary Source: USDA FoodData Central
Use for:
- nutrient normalization
- category reference ranges
- sugar/sodium/protein/fiber benchmarking
- fallback composition support

---

## 7. Suggested MVP Scope

### Phase 1
- Amazon product page support
- Packaged food focus
- Purchase score
- Health score
- Final verdict
- Simple widget UI

### Phase 2
- Cart page analysis
- Walmart support
- Target support
- Better explanation engine
- Healthier alternative suggestions

### Phase 3
- Mobile barcode scanner app
- Personal dietary profiles
- Saved history and user preferences
- Premium insights

---

## 8. Chrome Extension Design

### Components

#### A. Content Script
Responsibilities:
- detect current page type
- read DOM
- extract product fields
- watch DOM mutations for cart events
- send data to background/service worker

#### B. Service Worker
Responsibilities:
- central messaging hub
- backend API communication
- caching
- retry/error handling
- auth/session handling if needed later

#### C. UI Layer
Options:
- floating widget
- side panel
- popup

**Recommendation for MVP:** floating widget or side panel

---

## 9. Backend Design

### Recommended Backend Stack
- Python
- FastAPI
- Pydantic
- Uvicorn
- Optional Redis cache
- Optional Postgres later

### Backend Responsibilities
- accept extracted product payloads
- normalize fields
- enrich data using fallback sources
- run purchase scoring
- run health scoring
- generate explanation text
- return final structured decision

---

## 10. API Design

### Endpoint 1: POST /analyze

#### Request
```json
{
  "source_site": "amazon",
  "page_type": "product",
  "product": {
    "title": "Protein Bar Chocolate Peanut Butter",
    "brand": "Example Brand",
    "price": 2.99,
    "currency": "USD",
    "rating": 4.3,
    "review_count": 1842,
    "seller": "Example Seller",
    "return_policy_text": "Eligible for return within 30 days",
    "delivery_text": "Free delivery tomorrow",
    "ingredients_text": "Peanuts, whey protein, chicory root fiber, sugar, palm oil",
    "nutrition_text": "Calories 220, Total Fat 9g, Sodium 180mg, Total Sugars 12g, Protein 20g",
    "barcode": "123456789012"
  }
}
```

#### Response
```json
{
  "purchase_score": 76,
  "health_score": 58,
  "decision": "NEUTRAL",
  "category": "packaged_food",
  "reasons": [
    "Strong customer rating and review volume",
    "Moderate value for price",
    "Moderate nutritional profile"
  ],
  "warnings": [
    "Contains added sugar",
    "Processed ingredients present"
  ],
  "positives": [
    "Good protein content",
    "Widely reviewed product"
  ],
  "confidence": 0.84
}
```

---

### Endpoint 2: POST /extract-health
Optional endpoint if you want a separate extraction cleanup stage.

#### Request
```json
{
  "title": "Protein Bar Chocolate Peanut Butter",
  "ingredients_text": "Peanuts, whey protein, chicory root fiber, sugar, palm oil",
  "nutrition_text": "Calories 220, Total Fat 9g, Sodium 180mg, Total Sugars 12g, Protein 20g"
}
```

#### Response
```json
{
  "normalized_nutrition": {
    "calories": 220,
    "fat_g": 9,
    "sodium_mg": 180,
    "sugar_g": 12,
    "protein_g": 20
  },
  "ingredient_flags": [
    "added_sugar",
    "processed_oil"
  ]
}
```

---

### Endpoint 3: GET /health
#### Response
```json
{
  "status": "ok"
}
```

---

## 11. Data Model

### ProductInput
```python
from pydantic import BaseModel
from typing import Optional

class ProductInput(BaseModel):
    title: str
    brand: Optional[str] = None
    price: Optional[float] = None
    currency: Optional[str] = "USD"
    rating: Optional[float] = None
    review_count: Optional[int] = None
    seller: Optional[str] = None
    return_policy_text: Optional[str] = None
    delivery_text: Optional[str] = None
    ingredients_text: Optional[str] = None
    nutrition_text: Optional[str] = None
    barcode: Optional[str] = None
```

---

## 12. Purchase Scoring Model

### Goal
Score whether the item appears to be a good purchase from a buyer-quality perspective.

### Inputs
- rating
- review count
- price
- seller
- delivery
- return policy
- brand signals
- category signals

### Example Weighting
| Factor | Weight |
|---|---:|
| Review quality | 25% |
| Price fairness | 25% |
| Seller trust | 15% |
| Return policy | 10% |
| Popularity | 10% |
| Specs/value | 10% |
| Delivery speed | 5% |

### Example Logic
```python
purchase_score = (
    review_score * 0.25 +
    price_score * 0.25 +
    seller_score * 0.15 +
    return_score * 0.10 +
    popularity_score * 0.10 +
    spec_value_score * 0.10 +
    delivery_score * 0.05
)
```

### Rules of Thumb
- Many good reviews = bonus
- Very low review count = confidence penalty
- Third-party unknown seller = penalty
- Weak return policy = penalty
- Overpriced compared with category norms = penalty

---

## 13. Health Scoring Model for Packaged Food

### Goal
Score whether the food is a healthier packaged-food choice.

### Inputs
- sugar
- sodium
- saturated fat
- calories
- protein
- fiber
- ingredient count
- additives/preservatives
- ultra-processed signals

### Example Weighting
| Factor | Weight |
|---|---:|
| Nutrition quality | 50% |
| Ingredient quality | 30% |
| Processing level | 20% |

### Example Logic
```python
health_score = (
    nutrition_score * 0.50 +
    ingredient_score * 0.30 +
    processing_score * 0.20
)
```

### Health Signal Examples

#### Penalties
- high added sugar
- high sodium
- high saturated fat
- long ingredient list
- artificial colors/flavors
- multiple preservatives
- ultra-processed indicators

#### Bonuses
- high fiber
- high protein
- simple recognizable ingredients
- lower sugar for category
- lower sodium for category

---

## 14. Final Decision Logic

### Simple MVP Logic
```python
def final_decision(purchase_score: float, health_score: float | None, is_food: bool) -> str:
    if is_food and health_score is not None:
        if health_score < 40:
            return "DONT_BUY"
        if purchase_score > 80 and health_score > 70:
            return "BUY"
        if purchase_score < 50:
            return "DONT_BUY"
        return "NEUTRAL"

    if purchase_score >= 80:
        return "BUY"
    if purchase_score < 50:
        return "DONT_BUY"
    return "NEUTRAL"
```

### Later Improvements
- category-specific thresholds
- user health preferences
- price sensitivity preferences
- dietary restrictions
- family profile mode

---

## 15. Extraction Strategy

### First Principle
Do not rely on universal selectors across all websites.
Use a **site adapter pattern**.

### Adapter Structure
```text
extractors/
  amazon.py or amazon.ts
  walmart.py or walmart.ts
  target.py or target.ts
  generic.py or generic.ts
```

### Extraction Order
1. site-specific DOM selectors
2. JSON-LD structured data
3. meta tags
4. visible text blocks
5. LLM cleanup if text is messy

### Example Amazon Fields
- title
- price
- review count
- rating
- seller
- ingredients text
- nutrition text
- bullet points

### Cart Detection
Use DOM mutation observers to watch for:
- cart count changes
- mini-cart drawer open
- add-to-cart confirmation
- cart line item rendering

---

## 16. LLM Usage

### Use LLM For
- cleaning messy nutrition text
- extracting structured nutrients from mixed text
- generating human-readable explanations
- identifying ingredient warnings from raw ingredient lists

### Do Not Use LLM For
- primary scoring logic
- core numeric decision engine
- real-time scraping logic

### Why
Deterministic scoring is:
- cheaper
- more stable
- easier to debug
- more trustworthy

---

## 17. Frontend UX

### Widget Layout
```text
Verdict: BUY ✅
Purchase Score: 82/100
Health Score: 71/100

Why:
- Strong review volume
- Good value for category
- Moderate sugar, good protein balance

Warnings:
- Contains processed oil

Positives:
- High protein
- Reasonable sodium
```

### Cart View
```text
Cart Summary
- 2 BUY
- 1 NEUTRAL
- 1 DON’T BUY

Most concerning item:
Chocolate Snack Pack
Reason: high sugar + low value
```

---

## 18. Storage Strategy

### MVP
- no database required
- lightweight extension local cache
- optional in-memory cache at backend

### Later
Use PostgreSQL for:
- product history
- user preferences
- saved items
- feedback loops
- model calibration

### Optional Cache
Use Redis for:
- repeated product analyses
- barcode lookups
- nutrition normalization caching

---

## 19. Security and Privacy

### Collect Only What You Need
Send only:
- product metadata
- visible product-related text
- analysis context

Avoid sending:
- full browsing history
- user account details
- payment data
- personal profile data unless explicitly added later

### Extension Permissions
Keep permissions minimal:
- activeTab
- storage
- host permissions only for target shopping domains

### Disclaimers
For packaged foods, include:
- informational use only
- not medical advice
- verify label information before purchase

---

## 20. Folder Structure

### Monorepo Example
```text
shopping-health-copilot/
  extension/
    manifest.json
    src/
      content/
        main.ts
        extractors/
          amazon.ts
          walmart.ts
          target.ts
          generic.ts
      background/
        service-worker.ts
      ui/
        widget.tsx
        sidepanel.tsx
      shared/
        types.ts
        api.ts
        utils.ts

  backend/
    app/
      main.py
      routes/
        analyze.py
        health.py
      services/
        extract_normalizer.py
        purchase_scorer.py
        health_scorer.py
        decision_engine.py
        explainer.py
        product_classifier.py
        off_client.py
        usda_client.py
      models/
        product.py
        response.py
      tests/
        test_purchase_scorer.py
        test_health_scorer.py
        test_decision_engine.py
      requirements.txt
```

---

## 21. Development Plan

### Sprint 1
- extension scaffold
- product page detection
- Amazon extractor
- basic UI widget

### Sprint 2
- FastAPI backend
- /analyze endpoint
- purchase scoring engine
- explanation response

### Sprint 3
- health extraction
- health scoring logic
- Open Food Facts lookup
- UI enhancements

### Sprint 4
- cart analysis
- confidence scoring
- better error handling
- logs and analytics

---

## 22. Test Strategy

### Unit Tests
- purchase scorer
- health scorer
- final decision engine
- text normalization

### Integration Tests
- sample product page extraction
- backend response validation
- Open Food Facts fallback flow

### Manual QA
Test pages across:
- Amazon
- Walmart
- Target

Test categories:
- packaged snacks
- protein bars
- beverages
- breakfast foods
- non-food control items

---

## 23. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Retail DOM changes | extraction breaks | adapter-based selectors + fallbacks |
| Missing nutrition data | incomplete health score | fallback APIs + LLM cleanup |
| Slow response time | poor UX | caching + timeout strategy |
| Weak trust in verdict | low adoption | show reasons and confidence |
| Over-complex first version | delayed launch | start with Amazon packaged foods only |

---

## 24. Suggested MVP Positioning

### Simple Positioning
**AI that helps you avoid bad purchases and unhealthy packaged foods while shopping online.**

### Stronger Differentiator
**A shopping assistant that scores both value and health before you buy.**

---

## 25. Recommended First Launch

### Best First Launch Shape
- Chrome extension
- Amazon only
- packaged food focus
- purchase + health score
- Buy / Neutral / Don’t Buy verdict

This is narrow enough to build and broad enough to demonstrate real value.

---

## 26. Handover Summary for Engineering

### Build First
1. Chrome extension shell
2. Amazon extractor
3. FastAPI analyze endpoint
4. Purchase score logic
5. Health score logic
6. Verdict widget

### Integrate Next
1. Open Food Facts fallback
2. USDA normalization support
3. Explanation generator
4. Cart page support

### Delay Until Later
1. Mobile app
2. Personalized diet profiles
3. Price history
4. Multi-store optimization
5. Advanced recommendation engine

---

## 27. Final Recommendation

Do **not** wait for Yuka or Honey integrations.

Build your own core with:
- merchant page extraction
- Open Food Facts
- USDA FoodData Central
- deterministic scoring
- LLM explanation layer

That gives you:
- faster MVP
- lower dependency risk
- stronger product ownership
- better long-term defensibility

---

## End of Document
