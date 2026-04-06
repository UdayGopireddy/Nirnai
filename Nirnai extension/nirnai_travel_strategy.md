
# Nirnai Travel Platform Targeting Strategy

## Tagline
Clear decisions. Every purchase.

---

## 1. Objective

Define which travel/booking platforms Nirnai should support and in what order,
based on:
- trust gap
- user behavior
- engineering feasibility
- differentiation potential

---

## 2. Selection Framework

Platforms are prioritized using:

### 1. Trust Gap
- Are users misled by ratings?
- Are reviews overly positive or outdated?

### 2. User Frequency
- How often users interact with the platform

### 3. Data Accessibility
- Ability to extract:
  - rating
  - review count
  - review text
  - timestamps

---

## 3. Platform Prioritization

## 🥇 Tier 1 — Primary Target

### Airbnb

Why:
- Highest trust gap
- Reviews often biased or overly positive
- Major issues hidden in text:
  - cleanliness
  - misleading photos
  - host responsiveness
- High emotional and financial impact

Nirnai Strength:
- Recent Reality Signal
- Hidden risk detection
- Context signals (management change, quality drift)

Goal:
Prove Nirnai’s value as a **stay decision engine**

---

## 🥈 Tier 2 — Secondary Target

### Booking.com

Why:
- Large global inventory
- Structured review format (pros/cons)
- Easier sentiment extraction

Nirnai Strength:
- consistency detection
- theme-based scoring
- trend analysis

Goal:
Scale coverage and improve scoring robustness

---

## 🥉 Tier 3 — Expansion Platforms

### Expedia
### Hotels.com

Why:
- Aggregator platforms
- Larger scale
- Shared ecosystem

Goal:
Increase reach after validation

---

## 4. Platform Characteristics

| Platform   | Key Problem                     | Nirnai Opportunity             |
|------------|--------------------------------|--------------------------------|
| Airbnb     | Misleading positivity          | Trend + hidden risk detection  |
| Booking    | Averaged structured reviews    | Consistency + sentiment        |
| Expedia    | Aggregated noise               | Trust + filtering              |
| Hotels.com | Similar to Expedia             | Scale + redundancy             |

---

## 5. Rollout Plan

### Phase 1
- Airbnb only
- Build:
  - review extraction
  - recent reality scoring
  - sentiment themes

### Phase 2
- Add Booking.com
- Improve:
  - structured parsing
  - consistency scoring

### Phase 3
- Add Expedia
- Add Hotels.com

---

## 6. Engineering Architecture

Adapters:

```
travel/
  airbnb_adapter.ts
  booking_adapter.ts
  expedia_adapter.ts
  hotels_adapter.ts
```

Shared engine:

```
signal_engine/
  recent_reality.py
  sentiment_engine.py
  context_engine.py
```

---

## 7. Key Differentiator

Nirnai focuses on:

- what reviews don’t say explicitly
- what has changed recently
- what matters now

---

## 8. Product Positioning

> “Nirnai tells you what it’s like now — before you book.”

---

## 9. Strategy Summary

- Start with Airbnb (highest impact)
- Expand to Booking.com (scale + structure)
- Add Expedia/Hotels.com later
- Maintain one unified decision engine

---

## 10. Final Recommendation

Focus on:

1. Airbnb
2. Booking.com

Avoid expanding too early to multiple platforms.

---

## End
