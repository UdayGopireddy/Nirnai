# AI Shopping + Health Copilot

## Product Requirements & Development Handover Document

---

## 1. Product Overview

**Product Name (Working):** ShopWise AI / CartGuard / BuyRight AI  

**Vision:**  
Enable users to make smarter purchase decisions by analyzing:
- Product quality
- Price fairness
- Seller trust
- Health impact (for packaged food)

**Core Value Proposition:**  
Know instantly if a product is worth buying — for your wallet and your health.

---

## 2. Problem Statement

Users:
- Rely on misleading reviews
- Focus only on discounts
- Lack health awareness
- Make impulse purchases

Gap:
- No unified Buy / Don’t Buy decision engine

---

## 3. Core Features

### Product Detection
- Detect product page
- Detect cart page
- Detect add-to-cart events

### Data Extraction
- Title, price, rating, seller
- Ingredients, nutrition (if food)

### Purchase Score (0–100)
- Reviews (25%)
- Price (25%)
- Seller (15%)
- Return (10%)
- Popularity (10%)
- Specs (10%)
- Delivery (5%)

### Health Score (0–100)
- Nutrition (50%)
- Ingredients (30%)
- Processing (20%)

### Final Decision Logic
- Health < 40 → DON’T BUY
- Purchase > 80 & Health > 70 → BUY
- Purchase < 50 → DON’T BUY
- Else → NEUTRAL

---

## 4. Architecture

Chrome Extension → Content Script → Service Worker → FastAPI Backend → Scoring + AI

---

## 5. Tech Stack

Frontend:
- Chrome Extension (Manifest V3)
- TypeScript

Backend:
- Python FastAPI

AI:
- OpenAI API

---

## 6. API Example

POST /analyze

Request:
{
  "title": "",
  "price": "",
  "rating": "",
  "ingredients": ""
}

Response:
{
  "purchase_score": 78,
  "health_score": 62,
  "decision": "NEUTRAL"
}

---

## 7. Sanskrit Naming

- उत्पाद समीक्षा (Product Review)
- उत्पाद मूल्यांकन (Product Evaluation)
- उत्पाद निर्णय (Product Decision)

Recommended:
**उत्पाद मूल्यांकन एवं निर्णय**

---

## 8. Positioning

AI that protects your wallet AND your health while shopping online.

---

## 9. MVP Timeline

Week 1:
- Extension scaffold
- Amazon extraction

Week 2:
- Backend + scoring

Week 3:
- Health scoring + UI

---

## 10. Future Enhancements

- Multi-site support
- Price history
- Personalized health preferences
- Alternatives recommendation

---

## End
