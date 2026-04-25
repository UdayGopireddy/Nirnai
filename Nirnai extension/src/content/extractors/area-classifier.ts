// Adaptive search collection pipeline — works across all adapters
// Travel adapters: geo-aware (radius, map bounds, city classification)
// Shopping adapters: category-aware (product density, pagination)
// Provides a single collectListings() pipeline for content.ts

import { ProductData } from "../../types.js";

// ── Types ──

export interface SearchCenter {
  lat: number;
  lng: number;
}

export interface MapBounds {
  ne: SearchCenter; // northeast corner
  sw: SearchCenter; // southwest corner
}

export type AreaType = "dense_urban" | "urban" | "suburban" | "resort" | "rural";
export type DomainType = "travel" | "shopping";

export interface SearchProfile {
  domain: DomainType;
  areaType: AreaType;
  radiusMiles: number;     // 0 for shopping (no geo filter)
  maxListings: number;     // how many to send to Claude
  scrollCycles: number;    // how many times to auto-scroll
  label: string;           // human-readable for overlay + Claude context
}

// ── Determine Domain from Source Site ──

const TRAVEL_SITES = ["airbnb", "booking.com", "expedia.com", "vrbo", "hotels.com", "agoda", "tripadvisor", "googletravel", "makemytrip", "goibibo", "ixigo", "cleartrip", "yatra", "easemytrip"];
const SHOPPING_SITES = ["amazon", "walmart", "target", "bestbuy", "costco", "ebay", "homedepot", "lowes", "wayfair", "macys", "nordstrom", "cvs", "walgreens", "nike", "apple", "samsung", "dyson"];

export function detectDomain(siteName: string): DomainType {
  const name = siteName.toLowerCase();
  if (TRAVEL_SITES.some(s => name.includes(s))) return "travel";
  return "shopping";
}

// ── Haversine Distance ──

export function haversineDistance(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 3959; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Map Bounds → Profile (travel only) ──

function profileFromBounds(bounds: MapBounds): Omit<SearchProfile, "domain"> {
  const diagonal = haversineDistance(
    bounds.sw.lat, bounds.sw.lng,
    bounds.ne.lat, bounds.ne.lng
  );
  const effectiveRadius = diagonal / 2;

  if (effectiveRadius <= 1.5) {
    return { areaType: "dense_urban", radiusMiles: effectiveRadius, maxListings: 15, scrollCycles: 4, label: "dense urban area" };
  }
  if (effectiveRadius <= 4) {
    return { areaType: "urban", radiusMiles: effectiveRadius, maxListings: 15, scrollCycles: 4, label: "urban area" };
  }
  if (effectiveRadius <= 10) {
    return { areaType: "suburban", radiusMiles: effectiveRadius, maxListings: 12, scrollCycles: 3, label: "suburban area" };
  }
  return { areaType: "rural", radiusMiles: effectiveRadius, maxListings: 10, scrollCycles: 3, label: "wide area" };
}

// ── Known City Database ──

const DENSE_URBAN: string[] = [
  "manhattan", "downtown new york", "midtown", "soho", "tribeca", "chelsea ny",
  "downtown sf", "downtown san francisco", "financial district sf",
  "downtown chicago", "the loop", "river north",
  "downtown seattle", "capitol hill seattle",
  "downtown boston", "back bay", "beacon hill",
  "downtown dc", "dupont circle", "georgetown dc",
  "downtown la", "downtown los angeles", "hollywood",
  "downtown miami", "brickell", "south beach",
  "central london", "west end london", "covent garden", "soho london", "mayfair",
  "le marais", "montmartre", "saint-germain",
  "shibuya", "shinjuku", "ginza", "roppongi",
  "centro histórico", "condesa", "roma norte",
  "cbd sydney", "cbd melbourne",
  "downtown toronto", "downtown vancouver",
  "central singapore", "orchard road",
  "central hong kong", "tsim sha tsui",
];

const URBAN: string[] = [
  "brooklyn", "williamsburg", "bushwick", "queens", "astoria",
  "mission district", "castro", "haight", "soma", "noe valley",
  "wicker park", "logan square", "lincoln park", "lakeview",
  "capitol hill", "fremont seattle", "ballard",
  "east village", "lower east side", "upper west side", "harlem",
  "silver lake", "echo park", "venice la", "santa monica",
  "wynwood", "little havana", "coral gables",
  "shoreditch", "camden", "hackney", "notting hill", "brixton",
  "belleville", "bastille", "oberkampf",
  "shimokitazawa", "nakameguro", "ebisu",
  "colonia roma", "coyoacán", "polanco",
];

const RESORT: string[] = [
  "maui", "kauai", "big island hawaii", "oahu", "waikiki",
  "tulum", "cancun", "playa del carmen", "cabo san lucas",
  "bali", "ubud", "seminyak", "canggu",
  "santorini", "mykonos", "crete", "corfu",
  "phuket", "koh samui", "krabi",
  "maldives", "seychelles", "mauritius",
  "caribbean", "aruba", "barbados", "jamaica",
  "aspen", "vail", "park city", "whistler", "tahoe", "lake tahoe",
  "chamonix", "zermatt", "st moritz",
  "smoky mountains", "gatlinburg", "pigeon forge",
  "sedona", "joshua tree", "napa valley", "sonoma",
  "amalfi coast", "cinque terre", "tuscany",
  "costa rica", "monteverde", "manuel antonio",
];

// ── Classify Search Profile ──

export function classifySearch(
  siteName: string,
  destination: string,
  listingCount: number,
  bounds?: MapBounds
): SearchProfile {
  const domain = detectDomain(siteName);

  if (domain === "shopping") {
    return classifyShopping(siteName, listingCount);
  }
  return classifyTravel(destination, listingCount, bounds);
}

function classifyShopping(siteName: string, listingCount: number): SearchProfile {
  // Shopping sites: no radius, just density-based collection
  // High-density categories (electronics, clothing) → collect more, pick best
  // Low-density (niche products) → collect fewer

  if (listingCount >= 30) {
    return {
      domain: "shopping",
      areaType: "urban",  // reuse as "high density"
      radiusMiles: 0,
      maxListings: 15,
      scrollCycles: 4,
      label: `${siteName} search (high density)`,
    };
  }
  if (listingCount >= 10) {
    return {
      domain: "shopping",
      areaType: "suburban",  // "medium density"
      radiusMiles: 0,
      maxListings: 12,
      scrollCycles: 3,
      label: `${siteName} search (medium density)`,
    };
  }
  return {
    domain: "shopping",
    areaType: "rural",  // "low density"
    radiusMiles: 0,
    maxListings: 10,
    scrollCycles: 2,
    label: `${siteName} search (${listingCount} results)`,
  };
}

function classifyTravel(
  destination: string,
  listingCount: number,
  bounds?: MapBounds
): SearchProfile {
  // Strategy 1: Map bounds
  if (bounds) {
    const partial = profileFromBounds(bounds);
    if (destination) {
      partial.label = `${destination} (${partial.areaType.replace("_", " ")})`;
    }
    return { domain: "travel", ...partial };
  }

  // Strategy 2: Known city database
  const dest = destination.toLowerCase().trim();
  if (dest) {
    if (DENSE_URBAN.some(k => dest.includes(k))) {
      return { domain: "travel", areaType: "dense_urban", radiusMiles: 1, maxListings: 15, scrollCycles: 4, label: `${destination} (dense urban)` };
    }
    if (URBAN.some(k => dest.includes(k))) {
      return { domain: "travel", areaType: "urban", radiusMiles: 2, maxListings: 15, scrollCycles: 4, label: `${destination} (urban)` };
    }
    if (RESORT.some(k => dest.includes(k))) {
      return { domain: "travel", areaType: "resort", radiusMiles: 10, maxListings: 12, scrollCycles: 3, label: `${destination} (resort/destination)` };
    }
  }

  // Strategy 3: Listing density fallback
  if (listingCount >= 25) {
    return { domain: "travel", areaType: "urban", radiusMiles: 2, maxListings: 15, scrollCycles: 4, label: destination || "high-density area" };
  }
  if (listingCount >= 12) {
    return { domain: "travel", areaType: "suburban", radiusMiles: 5, maxListings: 12, scrollCycles: 3, label: destination || "mid-density area" };
  }
  return { domain: "travel", areaType: "rural", radiusMiles: 10, maxListings: 10, scrollCycles: 3, label: destination || "low-density area" };
}

// ── Filter by Radius (travel only, no-op for shopping) ──

export function filterByRadius(
  listings: ProductData[],
  center: SearchCenter,
  radiusMiles: number
): ProductData[] {
  if (radiusMiles <= 0) return listings; // shopping: no geo filter
  return listings.filter(listing => {
    const coords = parseListingCoords(listing);
    if (!coords) return true;
    return haversineDistance(center.lat, center.lng, coords.lat, coords.lng) <= radiusMiles;
  });
}

function parseListingCoords(listing: ProductData): SearchCenter | null {
  const ctx = listing.barcode || "";
  const latMatch = ctx.match(/lat=([-\d.]+)/);
  const lngMatch = ctx.match(/lng=([-\d.]+)/);
  if (latMatch && lngMatch) {
    return { lat: parseFloat(latMatch[1]), lng: parseFloat(lngMatch[1]) };
  }
  return null;
}

// ── Prioritize Data-Rich Listings ──

export function prioritizeDataRich(listings: ProductData[]): ProductData[] {
  return [...listings].sort((a, b) => dataScore(b) - dataScore(a));
}

function dataScore(l: ProductData): number {
  let score = 0;
  if (l.price && l.price.trim()) score += 3;
  if (l.rating && l.rating.trim()) score += 2;
  if (l.reviewCount && l.reviewCount.trim()) score += 2;
  if (l.title && l.title.length > 10) score += 1;
  if (l.imageUrl) score += 0.5;
  if (l.fulfiller) score += 0.5;
  if (l.nutritionInfo) score += 1;
  if (l.returnPolicy) score += 1;
  return score;
}

// ── Build Context String for Claude ──

export function buildSearchContext(profile: SearchProfile): string {
  if (profile.domain === "shopping") {
    return buildShoppingContext(profile);
  }
  return buildTravelContext(profile);
}

function buildTravelContext(profile: SearchProfile): string {
  const tips: Record<AreaType, string> = {
    dense_urban:
      "Walking distance and transit access are critical. " +
      "Noise level varies block-by-block. Every dollar of premium should buy a meaningfully better location. " +
      "High-floor/view premiums may be justified.",
    urban:
      "Neighborhood character matters — trendy vs quiet residential. " +
      "Transit proximity is important. Parking may cost extra. " +
      "Local vibe and walkability to restaurants/shops is a differentiator.",
    suburban:
      "Car likely required — factor in parking availability. " +
      "Pool, outdoor space, and property size matter more than walkability. " +
      "Price should reflect distance from attractions/downtown. " +
      "Quiet residential areas may be a plus for families.",
    resort:
      "Proximity to beach/slopes/attractions is the primary location factor. " +
      "Views and outdoor amenities (pool, terrace) justify premiums. " +
      "Cancellation flexibility is extra important for travel plans. " +
      "Season-specific amenities (AC in summer, heating in winter) are critical.",
    rural:
      "Isolation may be the point — but verify access to essentials. " +
      "Self-check-in and host responsiveness matter (no nearby help). " +
      "Internet/cell service should be mentioned. " +
      "Unique character and nature access justify price premiums.",
  };

  return `\n\nAREA CONTEXT: ${profile.label} (${profile.radiusMiles}-mile search radius, ${profile.areaType} density)\n${tips[profile.areaType]}`;
}

function buildShoppingContext(profile: SearchProfile): string {
  return `\n\nSEARCH CONTEXT: ${profile.label}` +
    "\nCompare products by value-for-money, brand reliability, review quality, and specification match." +
    "\nPrioritize: genuine reviews over volume, return policy quality, seller trustworthiness." +
    "\nFlag: suspiciously low prices, review manipulation patterns, unknown brands with inflated ratings.";
}

// ── Reusable Scroll-Collect Pipeline ──
// This is the single function that both autoRank and manual button call.

import { SiteExtractor, applyGeoContext, detectGeoContext } from "./base.js";

export interface CollectResult {
  listings: ProductData[];
  profile: SearchProfile;
  searchContext: string;
}

/**
 * Scroll-collects listings from the current search page, classifies the area/domain,
 * applies geo filtering (travel) or density filtering (shopping),
 * prioritizes data-rich entries, and returns the collection ready for Claude.
 *
 * @param ext        The active site extractor
 * @param onProgress Optional callback for UI updates (listing count so far)
 */
export async function collectListings(
  ext: SiteExtractor,
  onProgress?: (count: number, label: string) => void
): Promise<CollectResult> {
  const siteName = ext.siteName();
  const destination = ext.getSearchDestination?.() || "";
  const bounds = ext.getMapBounds?.() || undefined;

  // Quick initial card count for density estimation
  const quickCount = ext.extractSearchListings?.(100)?.length || 0;
  const profile = classifySearch(siteName, destination, quickCount, bounds);

  if (onProgress) onProgress(quickCount, profile.label);

  // Scroll-collect: progressively load more cards
  let allListings = ext.extractSearchListings?.(100) || [];

  for (let cycle = 0; cycle < profile.scrollCycles; cycle++) {
    window.scrollBy(0, window.innerHeight);
    await new Promise(r => setTimeout(r, 1500));
    const newListings = ext.extractSearchListings?.(100) || [];
    if (newListings.length <= allListings.length) break;
    allListings = newListings;
    if (onProgress) onProgress(allListings.length, profile.label);
  }

  // Scroll back to top
  window.scrollTo(0, 0);

  // Apply geo filter (travel only — no-op for shopping since radiusMiles=0)
  const center = ext.getSearchCenter?.() || null;
  if (center && profile.radiusMiles > 0) {
    allListings = filterByRadius(allListings, center, profile.radiusMiles);
  }

  // Prioritize data-rich and cap at maxListings
  allListings = prioritizeDataRich(allListings).slice(0, profile.maxListings);

  // Apply geo context to all collected listings
  const geo = detectGeoContext();
  allListings = allListings.map(l => applyGeoContext(l, geo));

  // Build search context string
  const contextStr = buildSearchContext(profile);
  const searchContext = window.location.href + contextStr;

  return { listings: allListings, profile, searchContext };
}
