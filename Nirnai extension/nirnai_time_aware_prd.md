
# Nirnai PRD – Time-Aware Decision Engine (Hotels & Reviews)

## 1. Product Overview

Nirnai is a **decision intelligence system** that helps users make clear, confident decisions by analyzing reviews, trust signals, and — critically — **time-based changes in quality**.

Core principle:
> "Don’t trust averages. Understand current reality."

---

## 2. Problem Statement

Current platforms (Amazon, Airbnb, Booking.com):
- Aggregate reviews over long periods
- Do not reflect recent changes
- Mislead users when quality declines or improves

User pain:
- “This looked great but was actually bad”
- “Reviews didn’t reflect current condition”

---

## 3. Core Innovation

### Time-Aware Scoring

Nirnai introduces:

## 👉 Recent Reality Signal (RRS)

This evaluates:
- How a product/place performs **now**
- Whether quality is **improving, declining, or stable**

---

## 4. Scoring System

### Final Score (0–100)

```
Final Score =
  Review Trust Score (30%) +
  Sentiment Quality Score (25%) +
  Recent Reality Score (25%) +
  Recency Weighting Score (10%) +
  Price/Value Score (10%)
```

---

## 5. Component Definitions

### 5.1 Review Trust Score (30%)
- Review count
- Distribution (skew detection)
- Authenticity signals

---

### 5.2 Sentiment Quality Score (25%)
Extract themes:
- Cleanliness
- Location
- Service
- Accuracy (photos vs reality)
- Noise / safety

---

### 5.3 Recent Reality Score (25%) ⭐ CORE DIFFERENTIATOR

Split reviews:

- Recent (0–3 months)
- Mid (3–12 months)
- Old (12+ months)

Weights:
- Recent: 0.6
- Mid: 0.3
- Old: 0.1

#### Signals:

##### 📉 Decline
Recent score << historical
→ Negative impact

##### 📈 Improvement
Recent score >> historical
→ Positive impact

##### ➖ Stability
Minimal variation
→ Neutral impact

##### 🔁 Event Detection
Detect keywords:
- “new management”
- “renovated”
- “declined recently”

---

### 5.4 Recency Weighting Score (10%)
- Higher weight to newer reviews
- Penalize outdated datasets

---

### 5.5 Price/Value Score (10%)
- Compare with similar listings/products
- Detect overpriced vs fair value

---

## 6. Decision Output System

### Badge

- 🟢 SMART BUY / SMART STAY
- 🟡 CHECK
- 🔴 AVOID

---

### Format

```
[STAMP]
[2–3 word reason]

[Supporting signals]
```

---

## 7. Example Outputs

### Case 1: Declining Quality

```
🔴 AVOID
Recently declined

⚠️ Lower ratings in last 3 months
⚠️ Cleanliness complaints increasing
```

---

### Case 2: Improvement

```
🟢 SMART STAY
Recently improved

✔ Strong recent reviews
✔ Renovation mentioned
```

---

### Case 3: Stable

```
🟢 SMART STAY
Consistent quality
```

---

## 8. Summary Explanation Logic

Each verdict must explain:

### Why score changed:

- “Recent reviews are worse than historical average”
- “Quality improved in last 3 months”
- “Consistent performance across time”

---

## 9. Key Differentiators

Nirnai:
- Detects **trend over time**
- Surfaces **hidden risks**
- Focuses on **decision clarity**

Competitors:
- Show averages
- Ignore recency shifts

---

## 10. MVP Scope

### Phase 1
- Airbnb / Amazon
- Review extraction
- Time segmentation
- Basic scoring

### Phase 2
- Trend detection
- Keyword-based event signals
- Improved sentiment modeling

---

## 11. Future Extensions

- Flights (price vs experience trends)
- Restaurants (chef/management changes)
- Retail products (quality drift)

---

## 12. One-Line Positioning

> “Nirnai shows what reviews don’t — what it’s like now.”

---

## End
