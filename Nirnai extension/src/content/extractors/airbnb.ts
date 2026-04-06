// Airbnb listing page extractor
// Uses meta tags, JSON-LD, data-section-id attributes, and aria-labels
// to avoid reliance on Airbnb's frequently-changing hashed CSS class names.

import { ProductData, CrossSiteSearchParams } from "../../types.js";
import { SiteExtractor, registerSearchUrlBuilder } from "./base.js";
import { SearchCenter, MapBounds } from "./area-classifier.js";

// Register Airbnb search URL builder for cross-site comparison
registerSearchUrlBuilder("airbnb", (p: CrossSiteSearchParams): string => {
  const slug = p.destination.replace(/,\s*/g, "--").replace(/\s+/g, "-");
  const path = slug
    ? `https://www.airbnb.com/s/${encodeURIComponent(slug)}/homes`
    : "https://www.airbnb.com/s/homes";
  const sp = new URLSearchParams();
  if (p.checkin) sp.set("checkin", p.checkin);
  if (p.checkout) sp.set("checkout", p.checkout);
  if (p.adults) sp.set("adults", p.adults);
  if (p.children) sp.set("children", p.children);
  return `${path}?${sp.toString()}`;
});

function extractText(selectors: string[]): string {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el?.textContent?.trim()) {
      return el.textContent.trim();
    }
  }
  return "";
}

function getMeta(property: string): string {
  const el = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`) as HTMLMetaElement | null;
  return el?.content?.trim() || "";
}

/**
 * Extract JSON-LD structured data from the page.
 * Airbnb embeds LodgingBusiness or similar schema.org types.
 */
function getJsonLd(): any | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "");
      const items = Array.isArray(data) ? data : data["@graph"] ? data["@graph"] : [data];
      for (const item of items) {
        const type = item["@type"];
        if (
          type === "LodgingBusiness" ||
          type === "Hotel" ||
          type === "VacationRental" ||
          type === "Product" ||
          type === "Place" ||
          (Array.isArray(type) && type.some((t: string) =>
            ["LodgingBusiness", "Hotel", "VacationRental", "Product", "Place"].includes(t)
          ))
        ) {
          return item;
        }
      }
      // If no specific type matched but there's a name, use it
      if (items.length === 1 && items[0].name) return items[0];
    } catch { /* skip bad JSON */ }
  }
  return null;
}

/**
 * Find text content within a section identified by data-section-id.
 */
function getSectionText(sectionId: string): string {
  const section = document.querySelector(`[data-section-id="${sectionId}"]`);
  return section?.textContent?.trim() || "";
}

export class AirbnbExtractor implements SiteExtractor {
  siteName(): string {
    return "airbnb";
  }

  isProductPage(): boolean {
    // Listing pages: /rooms/<id>
    if (/\/rooms\/\d+/.test(window.location.pathname)) return true;
    // Plus/Luxe listings can have different URL patterns
    if (/\/luxury\/listing\/\d+/.test(window.location.pathname)) return true;
    // Check meta tag as fallback
    if (getMeta("og:type") === "airbedandbreakfast:listing") return true;
    return false;
  }

  isCartPage(): boolean {
    // Airbnb doesn't have a traditional cart — wishlists are behind auth
    return false;
  }

  extractProduct(): ProductData {
    const jsonLd = getJsonLd();

    // ── Title ──
    const title =
      getMeta("og:title") ||
      jsonLd?.name ||
      extractText([
        '[data-section-id="TITLE_DEFAULT"] h1',
        '[data-section-id="TITLE_DEFAULT"] span',
        'h1[elementtiming="title"]',
        'h1',
      ]);

    // ── Price ──
    // Airbnb shows price per night in the booking panel
    const price = this.extractPrice(jsonLd);

    // ── Rating ──
    const rating =
      jsonLd?.aggregateRating?.ratingValue?.toString() ||
      this.extractRating();

    // ── Review count ──
    const reviewCount =
      jsonLd?.aggregateRating?.reviewCount?.toString() ||
      jsonLd?.aggregateRating?.ratingCount?.toString() ||
      this.extractReviewCount();

    // ── Host (mapped to brand + seller) ──
    const host = this.extractHostInfo();

    // ── Superhost / host status (mapped to fulfiller) ──
    const superhostStatus = this.extractSuperhostStatus();

    // ── Amenities (mapped to ingredients for agent interpretation) ──
    const amenities = this.extractAmenities();

    // ── Category ratings (mapped to nutritionInfo for agent interpretation) ──
    const categoryRatings = this.extractCategoryRatings();

    // ── Cancellation policy (mapped to returnPolicy) ──
    const cancellationPolicy = this.extractCancellationPolicy();

    // ── Check-in / checkout (mapped to delivery) ──
    const checkInOut = this.extractCheckInOut();

    // ── Property type / category ──
    const propertyType = this.extractPropertyType();

    // ── Image ──
    const imageUrl =
      getMeta("og:image") ||
      jsonLd?.image ||
      (document.querySelector('[data-testid="hero-image"] img') as HTMLImageElement)?.src ||
      (document.querySelector('[data-testid="photo-viewer-section"] img') as HTMLImageElement)?.src ||
      "";

    // ── Description (added to category for context) ──
    const description = getMeta("og:description") || jsonLd?.description || "";

    // ── Review snippets (limited sample for agent) ──
    const reviewSnippets = this.extractReviewSnippets();

    return {
      title,
      brand: host, // host name → brand
      price,
      currency: this.detectCurrency(),
      rating,
      reviewCount,
      seller: host, // host → seller (agent interprets "host" context from source_site)
      fulfiller: superhostStatus,
      ingredients: amenities, // amenities → ingredients field
      nutritionInfo: categoryRatings + (reviewSnippets ? `\n\nRecent reviews:\n${reviewSnippets}` : ""),
      returnPolicy: cancellationPolicy,
      delivery: checkInOut,
      category: propertyType + (description ? ` | ${description}` : ""),
      url: window.location.href,
      imageUrl: typeof imageUrl === "string" ? imageUrl : "",
      barcode: this.extractSearchContext(), // Carries search params for building filtered alternative URLs
      source_site: "airbnb",
      page_type: "product",
    };
  }

  extractCartProducts(): ProductData[] {
    return []; // Airbnb has no cart
  }

  isSearchPage(): boolean {
    // Search results: /s/{location}/homes or /s/homes with query params
    const path = window.location.pathname;
    if (/\/s\/[^/]+\/homes/.test(path)) return true;
    if (/\/s\/homes/.test(path) && window.location.search.includes("query")) return true;
    // Also match /s/ with search params
    if (path.startsWith("/s/") && window.location.search.includes("checkin")) return true;
    return false;
  }

  extractSearchListings(maxResults: number = 5): ProductData[] {
    const listings: ProductData[] = [];

    // Airbnb search results: each listing card is an <a> with itemprop="url" or inside [data-testid="card-container"]
    // Strategy: find listing card containers, extract data from each
    const cardSelectors = [
      '[itemprop="itemListElement"]',
      '[data-testid="card-container"]',
      '[data-testid="listing-card-title"]',
    ];

    let cards: Element[] = [];
    for (const sel of cardSelectors) {
      const found = document.querySelectorAll(sel);
      if (found.length > 0) {
        cards = Array.from(found);
        break;
      }
    }

    // Fallback: find all listing links matching /rooms/<id>
    if (cards.length === 0) {
      const links = document.querySelectorAll('a[href*="/rooms/"]');
      // De-duplicate by href — each listing may have multiple links
      const seen = new Set<string>();
      const uniqueLinks: Element[] = [];
      for (const link of links) {
        const href = (link as HTMLAnchorElement).href.split("?")[0];
        if (/\/rooms\/\d+/.test(href) && !seen.has(href)) {
          seen.add(href);
          // Walk up to find the card container (usually a few levels up)
          let container = link.parentElement;
          for (let i = 0; i < 6 && container; i++) {
            if (container.querySelector('img') && container.textContent && container.textContent.length > 50) {
              break;
            }
            container = container.parentElement;
          }
          uniqueLinks.push(container || link);
        }
      }
      cards = uniqueLinks;
    }

    for (const card of cards.slice(0, maxResults)) {
      try {
        const listing = this.extractSearchCard(card);
        if (listing && listing.title && listing.url) {
          listings.push(listing);
        }
      } catch { /* skip malformed card */ }
    }

    return listings;
  }

  private extractSearchCard(card: Element): ProductData | null {
    // ── URL ──
    const linkEl = card.querySelector('a[href*="/rooms/"]') as HTMLAnchorElement | null;
    const url = linkEl?.href || "";
    if (!url) return null;

    // ── Title ──
    // Airbnb titles can be in [data-testid="listing-card-title"], or in the link's text content
    const titleEl = card.querySelector('[data-testid="listing-card-title"]') ||
                    card.querySelector('[id^="title_"]');
    let title = titleEl?.textContent?.trim() || "";
    if (!title) {
      // Try aria-label on the link
      title = linkEl?.getAttribute("aria-label") || "";
    }
    if (!title) {
      // Fallback: first meaningful text in the card
      const spans = card.querySelectorAll("span, div");
      for (const span of spans) {
        const text = span.textContent?.trim() || "";
        if (text.length > 10 && text.length < 200 && !text.includes("$") && !text.includes("★")) {
          title = text;
          break;
        }
      }
    }

    // ── Price ──
    let price = "";
    const priceSpans = card.querySelectorAll("span");
    for (const span of priceSpans) {
      const text = span.textContent?.trim() || "";
      if (/[\$€£₹¥]\s*[\d,]+/.test(text)) {
        price = text;
        // Prefer "per night" context
        const parent = span.parentElement;
        if (parent?.textContent?.toLowerCase().includes("night")) {
          price = parent.textContent.trim();
        }
        break;
      }
    }

    // ── Rating ──
    let rating = "";
    const cardText = card.textContent || "";
    const ratingMatch = cardText.match(/(\d\.\d{1,2})\s*(?:\(|·)/);
    if (ratingMatch && parseFloat(ratingMatch[1]) <= 5.0) {
      rating = ratingMatch[1];
    }

    // ── Review count ──
    let reviewCount = "";
    const reviewMatch = cardText.match(/\((\d[\d,]*)\)/);
    if (reviewMatch) {
      reviewCount = reviewMatch[1];
    } else {
      const reviewMatch2 = cardText.match(/([\d,]+)\s*reviews?/i);
      if (reviewMatch2) reviewCount = reviewMatch2[1];
    }

    // ── Image ──
    const imgEl = card.querySelector("img") as HTMLImageElement | null;
    const imageUrl = imgEl?.src || "";

    // ── Property type / subtitle ──
    const subtitleEl = card.querySelector('[data-testid="listing-card-subtitle"]');
    const propertyType = subtitleEl?.textContent?.trim() || "";

    // ── Superhost badge ──
    let fulfiller = "";
    if (cardText.toLowerCase().includes("superhost")) {
      fulfiller = "Superhost";
    } else if (cardText.toLowerCase().includes("guest fav") || cardText.toLowerCase().includes("guest favourite")) {
      fulfiller = "Guest Favorite";
    }

    return {
      title,
      brand: "", // Host name not shown on search cards
      price,
      currency: this.detectCurrency(),
      rating,
      reviewCount,
      seller: "",
      fulfiller,
      ingredients: "", // amenities not available on search cards
      nutritionInfo: "",
      returnPolicy: "",
      delivery: "",
      category: propertyType,
      url: url.split("?")[0], // Clean URL without search params
      imageUrl,
      barcode: "",
      source_site: "airbnb",
      page_type: "search_result",
    };
  }

  // ── Private helpers ──

  private extractPrice(jsonLd: any): string {
    // JSON-LD price
    if (jsonLd?.offers?.price) {
      return `${jsonLd.offers.price} per night`;
    }

    // Look for price in the booking widget area
    // Airbnb uses spans with price info; look for "per night" pattern
    const priceElements = document.querySelectorAll('[data-testid="book-it-default"] span, [data-testid="price-element"] span');
    for (const el of priceElements) {
      const text = el.textContent?.trim() || "";
      if (/[\$€£₹¥]\s*\d+/.test(text) || /\d+\s*[\$€£₹¥]/.test(text)) {
        return text;
      }
    }

    // Broader search for price near "night" text
    const allSpans = document.querySelectorAll('span');
    for (const span of allSpans) {
      const text = span.textContent?.trim() || "";
      if (text.match(/[\$€£₹¥]\s*[\d,]+/) && text.toLowerCase().includes("night")) {
        return text;
      }
    }

    // Try meta tag
    const priceMeta = getMeta("airbedandbreakfast:price");
    if (priceMeta) return priceMeta + " per night";

    return "";
  }

  private extractRating(): string {
    // Look for rating near star icons or in specific sections
    const ratingEl = document.querySelector('[data-testid="pdp-reviews-highlight-banner-host-rating"] span');
    if (ratingEl?.textContent?.trim()) return ratingEl.textContent.trim();

    // Look for rating pattern like "4.95" near reviews
    const reviewSection = document.querySelector('[data-section-id="REVIEWS_DEFAULT"]');
    if (reviewSection) {
      const text = reviewSection.textContent || "";
      const match = text.match(/(\d\.\d{1,2})\s*·/);
      if (match) return match[1];
    }

    // Search in header area
    const headerSpans = document.querySelectorAll('header span, [data-section-id="TITLE_DEFAULT"] span');
    for (const span of headerSpans) {
      const text = span.textContent?.trim() || "";
      const match = text.match(/^(\d\.\d{1,2})$/);
      if (match && parseFloat(match[1]) <= 5.0) return match[1];
    }

    // Broader search for "★ X.XX" or "X.XX out of 5"
    const body = document.body.textContent || "";
    const ratingMatch = body.match(/(\d\.\d{1,2})\s*(?:out of 5|★)/);
    if (ratingMatch) return ratingMatch[1];

    return "";
  }

  private extractReviewCount(): string {
    // Pattern: "123 reviews" or "(123)"
    const reviewSection = document.querySelector('[data-section-id="REVIEWS_DEFAULT"]');
    if (reviewSection) {
      const text = reviewSection.textContent || "";
      const match = text.match(/([\d,]+)\s*reviews?/i);
      if (match) return match[1];
    }

    // Header area often shows "X reviews"
    const headerText = extractText([
      '[data-section-id="TITLE_DEFAULT"]',
    ]);
    const headerMatch = headerText.match(/([\d,]+)\s*reviews?/i);
    if (headerMatch) return headerMatch[1];

    // Button text like "Show all 234 reviews"
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || "";
      const match = text.match(/(?:show\s+all\s+)?([\d,]+)\s*reviews?/i);
      if (match) return match[1];
    }

    return "";
  }

  private extractHostInfo(): string {
    // Host section
    const hostSection = document.querySelector('[data-section-id="HOST_PROFILE_DEFAULT"]');
    if (hostSection) {
      const text = hostSection.textContent || "";
      const match = text.match(/Hosted by\s+(.+?)(?:\n|$|Superhost|·)/);
      if (match) return match[1].trim();
    }

    // Fallback: look for "Hosted by" anywhere
    const allText = document.body.textContent || "";
    const hostMatch = allText.match(/Hosted by\s+([A-Za-z\s]+?)(?:\s{2,}|\n|Superhost|·)/);
    if (hostMatch) return hostMatch[1].trim();

    return "";
  }

  private extractSuperhostStatus(): string {
    const hostSection = document.querySelector('[data-section-id="HOST_PROFILE_DEFAULT"]');
    const text = hostSection?.textContent || document.body.textContent || "";

    const parts: string[] = [];
    if (/superhost/i.test(text)) parts.push("Superhost");

    // Response rate
    const responseMatch = text.match(/Response rate:\s*(\d+%)/i);
    if (responseMatch) parts.push(`Response rate: ${responseMatch[1]}`);

    // Response time
    const timeMatch = text.match(/Response time:\s*([^\n]+)/i);
    if (timeMatch) parts.push(`Response time: ${timeMatch[1].trim()}`);

    // Years hosting
    const yearsMatch = text.match(/(\d+)\s*years?\s*hosting/i);
    if (yearsMatch) parts.push(`${yearsMatch[1]} years hosting`);

    // Identity verified
    if (/identity verified/i.test(text)) parts.push("Identity verified");

    return parts.join(" | ") || "";
  }

  private extractAmenities(): string {
    const amenitySection = document.querySelector('[data-section-id="AMENITIES_DEFAULT"]');
    if (amenitySection) {
      const items: string[] = [];
      const amenityEls = amenitySection.querySelectorAll('[data-testid="amenity-row"] span, li');
      amenityEls.forEach(el => {
        const text = el.textContent?.trim();
        if (text && !items.includes(text)) items.push(text);
      });
      if (items.length > 0) return items.slice(0, 30).join(", ");

      // Fallback: just grab all text from the section
      const sectionText = amenitySection.textContent?.trim() || "";
      if (sectionText) return sectionText.slice(0, 500);
    }

    // Try a modal/dialog for "Show all amenities"
    const modal = document.querySelector('[aria-label="Amenities"] , [data-testid="modal-container"]');
    if (modal) {
      const items: string[] = [];
      modal.querySelectorAll('div[role="listitem"], li').forEach(el => {
        const text = el.textContent?.trim();
        if (text && !items.includes(text)) items.push(text);
      });
      if (items.length > 0) return items.slice(0, 30).join(", ");
    }

    return "";
  }

  private extractCategoryRatings(): string {
    // Airbnb shows sub-ratings: Cleanliness, Accuracy, Check-in, Communication, Location, Value
    const reviewSection = document.querySelector('[data-section-id="REVIEWS_DEFAULT"]');
    if (!reviewSection) return "";

    const categories = ["Cleanliness", "Accuracy", "Check-in", "Communication", "Location", "Value"];
    const ratings: string[] = [];

    for (const cat of categories) {
      // Look for the category label followed by a rating number
      const text = reviewSection.textContent || "";
      const regex = new RegExp(`${cat}[:\\s]*(\\d\\.\\d)`, "i");
      const match = text.match(regex);
      if (match) {
        ratings.push(`${cat}: ${match[1]}`);
      }
    }

    if (ratings.length > 0) return `Category ratings: ${ratings.join(", ")}`;

    // Alternative: look for progress bars with aria-labels
    const progressBars = reviewSection.querySelectorAll('[role="progressbar"], [aria-label*="rating"]');
    for (const bar of progressBars) {
      const label = bar.getAttribute("aria-label") || "";
      if (label) ratings.push(label);
    }

    return ratings.length > 0 ? `Category ratings: ${ratings.join(", ")}` : "";
  }

  private extractCancellationPolicy(): string {
    const policySection = document.querySelector('[data-section-id="POLICIES_DEFAULT"]');
    if (policySection) {
      const text = policySection.textContent?.trim() || "";
      // Get first 300 chars of the policy section
      return text.slice(0, 300);
    }

    // Look for cancellation info in any section
    const allText = document.body.textContent || "";
    const match = allText.match(/(Free cancellation[^.]*\.|Cancellation policy[^.]*\.)/i);
    if (match) return match[1];

    return "";
  }

  private extractCheckInOut(): string {
    const parts: string[] = [];

    // Look in policies or house rules section
    const sections = [
      document.querySelector('[data-section-id="POLICIES_DEFAULT"]'),
      document.querySelector('[data-section-id="HOUSE_RULES_DEFAULT"]'),
    ];

    for (const section of sections) {
      if (!section) continue;
      const text = section.textContent || "";

      const checkIn = text.match(/Check-?in[:\s]*(?:after\s*)?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      if (checkIn) parts.push(`Check-in: ${checkIn[1]}`);

      const checkOut = text.match(/Check-?out[:\s]*(?:before\s*)?(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
      if (checkOut) parts.push(`Checkout: ${checkOut[1]}`);

      if (parts.length > 0) break;
    }

    // Guests count
    const body = document.body.textContent || "";
    const guestsMatch = body.match(/(\d+)\s*guests?/i);
    if (guestsMatch) parts.push(`${guestsMatch[1]} guests`);

    // Bedrooms / beds / baths
    const specMatch = body.match(/(\d+)\s*bedrooms?\s*·\s*(\d+)\s*beds?\s*·\s*(\d+\.?\d*)\s*baths?/i);
    if (specMatch) {
      parts.push(`${specMatch[1]} bedrooms, ${specMatch[2]} beds, ${specMatch[3]} baths`);
    }

    return parts.join(" | ");
  }

  private extractPropertyType(): string {
    // Look for property type in header/title area
    const titleSection = document.querySelector('[data-section-id="TITLE_DEFAULT"]');
    if (titleSection) {
      const text = titleSection.textContent || "";
      // Pattern: "Entire home", "Private room", "Shared room", "Entire villa", etc.
      const match = text.match(/(Entire\s+\w+|Private\s+room|Shared\s+room|Hotel\s+room)/i);
      if (match) return match[1];
    }

    // From the overview section
    const overview = document.querySelector('[data-section-id="OVERVIEW_DEFAULT"]');
    if (overview) {
      const text = overview.textContent || "";
      const match = text.match(/(Entire\s+\w+|Private\s+room|Shared\s+room|Hotel\s+room)/i);
      if (match) return match[1];
    }

    return getMeta("og:type") || "";
  }

  private extractReviewSnippets(): string {
    const reviewSection = document.querySelector('[data-section-id="REVIEWS_DEFAULT"]');
    if (!reviewSection) return "";

    const reviews: string[] = [];

    // Airbnb review blocks typically contain a reviewer name, date, and review text.
    // We look for date patterns (e.g., "March 2026", "2 weeks ago", "January 2025")
    // and pair them with the nearest review text.
    const allElements = reviewSection.querySelectorAll(
      '[data-testid*="review"], [role="listitem"], [data-review-id]'
    );

    // Date patterns Airbnb uses
    const dateRegex = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}|\d+\s+(?:days?|weeks?|months?|years?)\s+ago/i;

    // If structured review elements exist, parse them
    for (const reviewEl of allElements) {
      const fullText = reviewEl.textContent?.trim() || "";
      if (fullText.length < 20) continue;

      // Extract date from this review block
      const dateMatch = fullText.match(dateRegex);
      const dateStr = dateMatch ? `[${dateMatch[0]}]` : "";

      // Extract the review body (longest text span that isn't a name/date)
      const spans = reviewEl.querySelectorAll("span, div");
      let bestSnippet = "";
      for (const span of spans) {
        const t = span.textContent?.trim() || "";
        if (t.length > bestSnippet.length && t.length > 30 && t.length < 500 &&
            !t.includes("Show all") && !t.includes("Show more")) {
          bestSnippet = t;
        }
      }

      if (bestSnippet) {
        reviews.push(dateStr ? `${dateStr} ${bestSnippet}` : bestSnippet);
        if (reviews.length >= 6) break;
      }
    }

    // Fallback: grab any substantial text blocks from the review section
    if (reviews.length === 0) {
      const blocks = reviewSection.querySelectorAll('span, div');
      for (const block of blocks) {
        const text = block.textContent?.trim() || "";
        if (text.length > 30 && text.length < 500 &&
            !text.includes("Show all") && !text.includes("Show more")) {
          // Check for a date nearby
          const dateMatch = text.match(dateRegex);
          if (dateMatch) {
            reviews.push(`[${dateMatch[0]}] ${text}`);
          } else {
            reviews.push(text);
          }
          if (reviews.length >= 6) break;
        }
      }
    }

    // Also extract review date distribution summary if we can find dates
    const allText = reviewSection.textContent || "";
    const allDates = [...allText.matchAll(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/gi)];
    if (allDates.length > 0) {
      const dateList = allDates.map(m => m[0]);
      const newest = dateList[0];
      const oldest = dateList[dateList.length - 1];
      const recentCount = dateList.filter(d => {
        // Count reviews from the last 3 months
        const match = d.match(/(\w+)\s+(\d{4})/);
        if (!match) return false;
        const months = ["january","february","march","april","may","june","july","august","september","october","november","december"];
        const monthIdx = months.indexOf(match[1].toLowerCase());
        const year = parseInt(match[2]);
        const reviewDate = new Date(year, monthIdx);
        const threeMonthsAgo = new Date();
        threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
        return reviewDate >= threeMonthsAgo;
      }).length;

      reviews.unshift(
        `[REVIEW TIMELINE] ${allDates.length} dated reviews found. Newest: ${newest}. Oldest: ${oldest}. Reviews in last 3 months: ${recentCount}/${allDates.length}.`
      );
    }

    return reviews.join("\n---\n");
  }

  private detectCurrency(): string {
    const url = window.location.href;
    // Airbnb uses currency query params or subdomain
    const currMatch = url.match(/[?&]currency=([A-Z]{3})/i);
    if (currMatch) return currMatch[1].toUpperCase();

    // Check the price text for currency symbols
    const priceText = document.body.textContent || "";
    if (priceText.includes("₹")) return "INR";
    if (priceText.includes("€")) return "EUR";
    if (priceText.includes("£")) return "GBP";
    if (priceText.includes("¥")) return "JPY";

    return "USD";
  }

  /**
   * Extract the listing's location (City, State/Country) from multiple DOM sources.
   * Airbnb listings can have custom titles that don't contain the location,
   * so we check the subtitle, breadcrumbs, overview, and structured data.
   */
  private extractLocation(): string {
    const locationRegex = /in\s+([A-Za-z\s.'-]+,\s*[A-Za-z\s.'-]+)/i;

    // 1. Check the property type line below the title: "Entire home in Tampa, Florida"
    //    This is typically an h2 or a separate section from the title
    const overviewSection = document.querySelector('[data-section-id="OVERVIEW_DEFAULT"]');
    if (overviewSection) {
      const match = overviewSection.textContent?.match(locationRegex);
      if (match) return match[1].trim();
    }

    // 2. Check all h2 elements (the subtitle "Entire guest suite in Tampa, Florida")
    const h2s = document.querySelectorAll('h2');
    for (const h2 of h2s) {
      const match = h2.textContent?.match(locationRegex);
      if (match) return match[1].trim();
    }

    // 3. Check the title section (works when title IS "Entire home in Tampa, Florida")
    const titleSection = document.querySelector('[data-section-id="TITLE_DEFAULT"]');
    if (titleSection) {
      const match = titleSection.textContent?.match(locationRegex);
      if (match) return match[1].trim();
    }

    // 4. Check breadcrumb/navigation
    const breadcrumbs = document.querySelectorAll('nav a, [data-testid="breadcrumb"] a');
    for (const crumb of breadcrumbs) {
      const text = crumb.textContent?.trim() || "";
      // Breadcrumbs often have just the city name
      if (text.length > 2 && text.length < 40 && !text.includes("Airbnb") && !text.includes("Home")) {
        // Check if it looks like a location
        if (/^[A-Z][a-z]/.test(text)) return text;
      }
    }

    // 5. Check og:title meta: "Extraordinary House close to everything. - Villas for Rent in Tampa, Florida"
    const ogTitle = getMeta("og:title");
    if (ogTitle) {
      const match = ogTitle.match(locationRegex);
      if (match) return match[1].trim();
      // Also try "in City" without state
      const cityMatch = ogTitle.match(/in\s+([A-Z][A-Za-z\s.'-]+?)(?:\s*[-–—|]|$)/);
      if (cityMatch) return cityMatch[1].trim();
    }

    // 6. Document title fallback
    const docTitle = document.title || "";
    const titleMatch = docTitle.match(locationRegex);
    if (titleMatch) return titleMatch[1].trim();

    // 7. Scan the first 5000 chars of visible body text for "City, State" patterns near "in"
    const bodySnippet = document.body.innerText?.slice(0, 5000) || "";
    const bodyMatch = bodySnippet.match(locationRegex);
    if (bodyMatch) return bodyMatch[1].trim();

    return "";
  }

  /**
   * Build a ready-to-use Airbnb search URL with the user's dates, guests,
   * and location pre-filled. The agent only needs to append extra filters.
   * Also includes raw search context for the agent prompt.
   */
  private extractSearchContext(): string {
    const params = new URLSearchParams(window.location.search);

    const checkin = params.get("check_in") || "";
    const checkout = params.get("check_out") || "";
    const adults = params.get("adults") || "2";
    const children = params.get("children") || "";
    const infants = params.get("infants") || "";

    // Extract location — check multiple sources since listing titles may be custom names
    const location = this.extractLocation();

    // Bedrooms from specs
    const specText = document.body.textContent || "";
    const bedroomMatch = specText.match(/(\d+)\s*bedrooms?/i);
    const minBedrooms = bedroomMatch ? bedroomMatch[1] : "";

    // Build the actual working search URL
    const locationSlug = location
      ? location.replace(/,\s*/g, "--").replace(/\s+/g, "-")
      : "";
    const searchPath = locationSlug
      ? `https://www.airbnb.com/s/${encodeURIComponent(locationSlug)}/homes`
      : "https://www.airbnb.com/s/homes";

    const searchParams = new URLSearchParams();
    if (checkin) searchParams.set("checkin", checkin);
    if (checkout) searchParams.set("checkout", checkout);
    if (adults) searchParams.set("adults", adults);
    if (children) searchParams.set("children", children);
    if (infants) searchParams.set("infants", infants);
    if (minBedrooms) searchParams.set("min_bedrooms", minBedrooms);

    const baseSearchUrl = `${searchPath}?${searchParams.toString()}`;

    // Return both the pre-built URL and raw context
    return [
      `search_base_url=${baseSearchUrl}`,
      `location=${location}`,
      `checkin=${checkin}`,
      `checkout=${checkout}`,
      `adults=${adults}`,
      children ? `children=${children}` : "",
      minBedrooms ? `min_bedrooms=${minBedrooms}` : "",
    ].filter(Boolean).join("&");
  }

  // ── Geo methods for adaptive radius ──

  getMapBounds(): MapBounds | null {
    const params = new URLSearchParams(window.location.search);
    const neLat = parseFloat(params.get("ne_lat") || "");
    const neLng = parseFloat(params.get("ne_lng") || "");
    const swLat = parseFloat(params.get("sw_lat") || "");
    const swLng = parseFloat(params.get("sw_lng") || "");
    if (!isNaN(neLat) && !isNaN(neLng) && !isNaN(swLat) && !isNaN(swLng)) {
      return { ne: { lat: neLat, lng: neLng }, sw: { lat: swLat, lng: swLng } };
    }
    return null;
  }

  getSearchCenter(): SearchCenter | null {
    const bounds = this.getMapBounds();
    if (bounds) {
      return {
        lat: (bounds.ne.lat + bounds.sw.lat) / 2,
        lng: (bounds.ne.lng + bounds.sw.lng) / 2,
      };
    }
    return null;
  }

  getSearchDestination(): string {
    // Airbnb path: /s/{location}/homes
    const pathMatch = window.location.pathname.match(/\/s\/([^/]+)\/homes/);
    if (pathMatch) {
      return decodeURIComponent(pathMatch[1]).replace(/--/g, ", ").replace(/-/g, " ");
    }
    const params = new URLSearchParams(window.location.search);
    return params.get("query") || "";
  }

  getSearchParams(): CrossSiteSearchParams | null {
    const params = new URLSearchParams(window.location.search);
    const destination = this.getSearchDestination();
    if (!destination) return null;
    return {
      destination,
      checkin: params.get("checkin") || params.get("check_in") || "",
      checkout: params.get("checkout") || params.get("check_out") || "",
      adults: params.get("adults") || "2",
      children: params.get("children") || "",
      rooms: "1",
    };
  }
}
