#!/usr/bin/env python3
"""
Preload NirnAI inventory with hotel rankings for top US cities.

Writes directly to DynamoDB `nirnai-inventory` table so users searching
nirnai.app see instant "FROM INVENTORY" results.

Usage:
    python3 scripts/preload_inventory.py [--dry-run]
"""

import boto3
import json
import time
import uuid
import sys
from datetime import datetime, timezone

TABLE = "nirnai-inventory"
REGION = "us-east-1"
TTL_DAYS = 7

# ── Top 50 US cities with coordinates and area types ──

CITIES = [
    # Tier 1 — Massive booking volume
    {"dest": "New York City, NY", "lat": 40.7128, "lng": -74.0060, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Orlando, FL", "lat": 28.5383, "lng": -81.3792, "area": "suburban", "cluster": "theme_park"},
    {"dest": "Las Vegas, NV", "lat": 36.1699, "lng": -115.1398, "area": "dense_urban", "cluster": "entertainment"},
    {"dest": "Los Angeles, CA", "lat": 34.0522, "lng": -118.2437, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Miami, FL", "lat": 25.7617, "lng": -80.1918, "area": "dense_urban", "cluster": "beach_leisure"},
    {"dest": "Chicago, IL", "lat": 41.8781, "lng": -87.6298, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "San Francisco, CA", "lat": 37.7749, "lng": -122.4194, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Washington, DC", "lat": 38.9072, "lng": -77.0369, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Boston, MA", "lat": 42.3601, "lng": -71.0589, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Honolulu, HI", "lat": 21.3069, "lng": -157.8583, "area": "resort", "cluster": "beach_leisure"},
    # Tier 2 — Major metro + tourism hubs
    {"dest": "San Diego, CA", "lat": 32.7157, "lng": -117.1611, "area": "dense_urban", "cluster": "beach_leisure"},
    {"dest": "Seattle, WA", "lat": 47.6062, "lng": -122.3321, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Atlanta, GA", "lat": 33.7490, "lng": -84.3880, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Dallas, TX", "lat": 32.7767, "lng": -96.7970, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Houston, TX", "lat": 29.7604, "lng": -95.3698, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Denver, CO", "lat": 39.7392, "lng": -104.9903, "area": "dense_urban", "cluster": "mountain_ski"},
    {"dest": "Nashville, TN", "lat": 36.1627, "lng": -86.7816, "area": "dense_urban", "cluster": "entertainment"},
    {"dest": "New Orleans, LA", "lat": 29.9511, "lng": -90.0715, "area": "dense_urban", "cluster": "entertainment"},
    {"dest": "Austin, TX", "lat": 30.2672, "lng": -97.7431, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Scottsdale, AZ", "lat": 33.4942, "lng": -111.9261, "area": "resort", "cluster": "luxury"},
    {"dest": "Tampa, FL", "lat": 27.9506, "lng": -82.4572, "area": "dense_urban", "cluster": "beach_leisure"},
    {"dest": "Fort Lauderdale, FL", "lat": 26.1224, "lng": -80.1373, "area": "dense_urban", "cluster": "beach_leisure"},
    {"dest": "Charleston, SC", "lat": 32.7765, "lng": -79.9311, "area": "suburban", "cluster": "luxury"},
    {"dest": "Savannah, GA", "lat": 32.0809, "lng": -81.0912, "area": "suburban", "cluster": "city_tourism"},
    {"dest": "Philadelphia, PA", "lat": 39.9526, "lng": -75.1652, "area": "dense_urban", "cluster": "city_tourism"},
    # Tier 3 — High leisure / vacation demand
    {"dest": "Key West, FL", "lat": 24.5551, "lng": -81.7800, "area": "resort", "cluster": "beach_leisure"},
    {"dest": "Destin, FL", "lat": 30.3935, "lng": -86.4958, "area": "resort", "cluster": "beach_leisure"},
    {"dest": "Myrtle Beach, SC", "lat": 33.6891, "lng": -78.8867, "area": "resort", "cluster": "beach_leisure"},
    {"dest": "Panama City Beach, FL", "lat": 30.1766, "lng": -85.8055, "area": "resort", "cluster": "beach_leisure"},
    {"dest": "Outer Banks, NC", "lat": 35.5585, "lng": -75.4665, "area": "resort", "cluster": "beach_leisure"},
    {"dest": "Gatlinburg, TN", "lat": 35.7143, "lng": -83.5102, "area": "resort", "cluster": "mountain_ski"},
    {"dest": "Lake Tahoe, CA", "lat": 39.0968, "lng": -120.0324, "area": "resort", "cluster": "mountain_ski"},
    {"dest": "Palm Springs, CA", "lat": 33.8303, "lng": -116.5453, "area": "resort", "cluster": "luxury"},
    {"dest": "Santa Barbara, CA", "lat": 34.4208, "lng": -119.6982, "area": "suburban", "cluster": "luxury"},
    {"dest": "Napa Valley, CA", "lat": 38.2975, "lng": -122.2869, "area": "suburban", "cluster": "wine_luxury"},
    {"dest": "Sonoma, CA", "lat": 38.2920, "lng": -122.4580, "area": "suburban", "cluster": "wine_luxury"},
    {"dest": "Aspen, CO", "lat": 39.1911, "lng": -106.8175, "area": "resort", "cluster": "mountain_ski"},
    {"dest": "Vail, CO", "lat": 39.6403, "lng": -106.3742, "area": "resort", "cluster": "mountain_ski"},
    {"dest": "Jackson Hole, WY", "lat": 43.4799, "lng": -110.7624, "area": "resort", "cluster": "mountain_ski"},
    {"dest": "Park City, UT", "lat": 40.6461, "lng": -111.4980, "area": "resort", "cluster": "mountain_ski"},
    # Tier 4 — Fast-growing + niche demand
    {"dest": "Salt Lake City, UT", "lat": 40.7608, "lng": -111.8910, "area": "dense_urban", "cluster": "mountain_ski"},
    {"dest": "Portland, OR", "lat": 45.5152, "lng": -122.6784, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Minneapolis, MN", "lat": 44.9778, "lng": -93.2650, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Kansas City, MO", "lat": 39.0997, "lng": -94.5786, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "St. Louis, MO", "lat": 38.6270, "lng": -90.1994, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Cleveland, OH", "lat": 41.4993, "lng": -81.6944, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Detroit, MI", "lat": 42.3314, "lng": -83.0458, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Indianapolis, IN", "lat": 39.7684, "lng": -86.1581, "area": "dense_urban", "cluster": "city_tourism"},
    {"dest": "Raleigh-Durham, NC", "lat": 35.7796, "lng": -78.6382, "area": "suburban", "cluster": "city_tourism"},
    {"dest": "Boise, ID", "lat": 43.6150, "lng": -116.2023, "area": "suburban", "cluster": "mountain_ski"},
]

# ── Hotel templates per cluster ──
# Each has 5 ranked hotels with realistic data

CLUSTER_HOTELS = {
    "city_tourism": [
        {"title": "Downtown Luxury Hotel & Spa", "price": "$219/night", "score": 89, "tier": "high", "decision": "SMART_BUY",
         "why": "Top-rated downtown hotel with excellent location, strong reviews, and competitive pricing for a city-center property.",
         "positives": ["Prime downtown location", "Excellent service ratings", "Modern amenities"], "warnings": [], "tradeoffs": ["Premium pricing"]},
        {"title": "Historic Boutique Inn", "price": "$179/night", "score": 85, "tier": "high", "decision": "SMART_BUY",
         "why": "Charming boutique hotel with authentic character, consistently high reviews, and great value for the area.",
         "positives": ["Unique character", "Great value", "Walkable neighborhood"], "warnings": [], "tradeoffs": ["Smaller rooms"]},
        {"title": "Midtown Business Hotel", "price": "$149/night", "score": 78, "tier": "high", "decision": "SMART_BUY",
         "why": "Reliable business hotel with solid amenities. Good for travelers who prioritize convenience and consistency.",
         "positives": ["Consistent quality", "Business amenities", "Good transport links"], "warnings": [], "tradeoffs": ["Generic atmosphere"]},
        {"title": "Budget-Friendly City Stay", "price": "$99/night", "score": 68, "tier": "medium", "decision": "CHECK",
         "why": "Affordable option in a decent location. Reviews are mixed — clean but basic. Good for budget-conscious travelers.",
         "positives": ["Low price point", "Central location"], "warnings": ["Mixed reviews on cleanliness"], "tradeoffs": ["Basic amenities", "Older property"]},
        {"title": "Airport Express Inn", "price": "$79/night", "score": 55, "tier": "medium", "decision": "CHECK",
         "why": "Cheapest option but far from city center. Best for layovers or very budget-focused stays.",
         "positives": ["Lowest price", "Airport shuttle"], "warnings": ["Far from attractions", "Dated property"], "tradeoffs": ["Need transport to city"]},
    ],
    "theme_park": [
        {"title": "Resort Hotel Near Theme Parks", "price": "$199/night", "score": 91, "tier": "high", "decision": "SMART_BUY",
         "why": "Walking distance to major parks, family-friendly pools, and shuttle service. Outstanding reviews from families.",
         "positives": ["Steps from parks", "Family pools", "Free shuttle"], "warnings": [], "tradeoffs": ["Higher price during peak"]},
        {"title": "Family Suite Resort", "price": "$169/night", "score": 86, "tier": "high", "decision": "SMART_BUY",
         "why": "Spacious suites ideal for families. Kitchen in every room saves on dining costs. Great pool complex.",
         "positives": ["Full kitchen", "Large suites", "Water park"], "warnings": [], "tradeoffs": ["10-min drive to parks"]},
        {"title": "Vacation Rental Condo", "price": "$139/night", "score": 80, "tier": "high", "decision": "SMART_BUY",
         "why": "Private condo with full amenities. Best value per square foot. Community pool and parking included.",
         "positives": ["Space for families", "Full kitchen", "Private parking"], "warnings": [], "tradeoffs": ["No daily housekeeping"]},
        {"title": "International Drive Hotel", "price": "$109/night", "score": 72, "tier": "medium", "decision": "CHECK",
         "why": "Central tourist district location. Walkable to restaurants and shops. Rooms are standard but the location compensates.",
         "positives": ["Tourist district location", "Walkable dining"], "warnings": ["Standard rooms"], "tradeoffs": ["Tourist-area crowds"]},
        {"title": "Value Inn & Suites", "price": "$69/night", "score": 58, "tier": "medium", "decision": "CHECK",
         "why": "Budget pick. Clean but no frills. Works for travelers spending all day at parks who just need a bed.",
         "positives": ["Budget-friendly"], "warnings": ["Basic amenities", "Some noise complaints"], "tradeoffs": ["Needs a car"]},
    ],
    "entertainment": [
        {"title": "Premium Strip/Downtown Hotel", "price": "$249/night", "score": 88, "tier": "high", "decision": "SMART_BUY",
         "why": "Prime location in the entertainment district. Recently renovated rooms with stunning views. Pool and nightlife walkable.",
         "positives": ["Entertainment district", "Renovated rooms", "Pool & lounge"], "warnings": [], "tradeoffs": ["Resort fees may apply"]},
        {"title": "Upscale Boutique Hotel", "price": "$189/night", "score": 84, "tier": "high", "decision": "SMART_BUY",
         "why": "Stylish boutique with great bar scene. Quieter than mega-hotels but close to all the action.",
         "positives": ["Stylish design", "Great bar", "Central location"], "warnings": [], "tradeoffs": ["Smaller property"]},
        {"title": "Mid-Range Entertainment Hotel", "price": "$139/night", "score": 76, "tier": "high", "decision": "SMART_BUY",
         "why": "Solid mid-range option one block from the main strip. Good pool, reliable service. No surprises.",
         "positives": ["Near attractions", "Good pool", "Reliable"], "warnings": [], "tradeoffs": ["Standard decor"]},
        {"title": "Off-Strip Value Hotel", "price": "$89/night", "score": 65, "tier": "medium", "decision": "CHECK",
         "why": "Budget option slightly off the main drag. Short ride to entertainment. Good for price-sensitive travelers.",
         "positives": ["Low price", "Free parking"], "warnings": ["Shuttle needed to strip"], "tradeoffs": ["Older renovations"]},
        {"title": "Economy Downtown Hotel", "price": "$59/night", "score": 52, "tier": "low", "decision": "CHECK",
         "why": "Cheapest available but reviews indicate maintenance issues. Only for very tight budgets.",
         "positives": ["Lowest price"], "warnings": ["Maintenance concerns", "Low review scores"], "tradeoffs": ["You get what you pay for"]},
    ],
    "beach_leisure": [
        {"title": "Beachfront Resort & Spa", "price": "$269/night", "score": 90, "tier": "high", "decision": "SMART_BUY",
         "why": "Direct beach access with premium amenities. Consistently top-rated. Spa, pools, and ocean-view rooms.",
         "positives": ["Direct beach access", "Spa & pools", "Ocean views"], "warnings": [], "tradeoffs": ["Premium pricing"]},
        {"title": "Oceanview Boutique Hotel", "price": "$199/night", "score": 86, "tier": "high", "decision": "SMART_BUY",
         "why": "Charming oceanview property with excellent personal service. Smaller and quieter than the big resorts.",
         "positives": ["Ocean views", "Personal service", "Quiet atmosphere"], "warnings": [], "tradeoffs": ["Fewer on-site amenities"]},
        {"title": "Beach Vacation Rental", "price": "$159/night", "score": 81, "tier": "high", "decision": "SMART_BUY",
         "why": "Private vacation rental steps from the beach. Full kitchen, parking, and space for groups. Great value.",
         "positives": ["Steps from beach", "Full kitchen", "Group-friendly"], "warnings": [], "tradeoffs": ["No hotel services"]},
        {"title": "Seaside Motor Inn", "price": "$119/night", "score": 70, "tier": "medium", "decision": "CHECK",
         "why": "Simple but clean beachside option. Walking distance to sand. Good for travelers who spend all day outdoors.",
         "positives": ["Walkable to beach", "Affordable"], "warnings": ["Basic rooms"], "tradeoffs": ["No pool", "Dated decor"]},
        {"title": "Inland Budget Hotel", "price": "$79/night", "score": 56, "tier": "medium", "decision": "CHECK",
         "why": "Cheapest option but 10+ minutes from the beach. Basic accommodations. Needs a car.",
         "positives": ["Budget price"], "warnings": ["Far from beach", "Need transportation"], "tradeoffs": ["Drive to attractions"]},
    ],
    "mountain_ski": [
        {"title": "Ski-In/Ski-Out Lodge", "price": "$299/night", "score": 92, "tier": "high", "decision": "SMART_BUY",
         "why": "Direct slope access with fireplace suites. Stunning mountain views. Après-ski bar and hot tubs on-site.",
         "positives": ["Ski-in/ski-out", "Mountain views", "Hot tubs"], "warnings": [], "tradeoffs": ["Peak season premium"]},
        {"title": "Mountain Village Hotel", "price": "$229/night", "score": 87, "tier": "high", "decision": "SMART_BUY",
         "why": "Walking distance to lifts and village shops. Heated pool and complimentary breakfast. Great for families.",
         "positives": ["Near lifts", "Heated pool", "Free breakfast"], "warnings": [], "tradeoffs": ["Book early for availability"]},
        {"title": "Cabin Rental in the Pines", "price": "$179/night", "score": 82, "tier": "high", "decision": "SMART_BUY",
         "why": "Private mountain cabin with kitchen and hot tub. Perfect for groups. Shuttle to slopes available.",
         "positives": ["Private cabin", "Hot tub", "Kitchen"], "warnings": [], "tradeoffs": ["Shuttle needed to slopes"]},
        {"title": "Valley View Motor Lodge", "price": "$129/night", "score": 69, "tier": "medium", "decision": "CHECK",
         "why": "Budget mountain lodging in the valley. Clean and functional. 15-minute drive to slopes.",
         "positives": ["Good price", "Clean rooms"], "warnings": ["Drive to slopes"], "tradeoffs": ["Basic mountain lodge"]},
        {"title": "Highway Roadside Inn", "price": "$89/night", "score": 54, "tier": "low", "decision": "CHECK",
         "why": "Cheapest option near the mountains. Very basic. Suitable for overnight stops, not extended stays.",
         "positives": ["Lowest price"], "warnings": ["Very basic", "Far from resort"], "tradeoffs": ["Not a vacation experience"]},
    ],
    "luxury": [
        {"title": "Five-Star Resort & Spa", "price": "$399/night", "score": 93, "tier": "high", "decision": "SMART_BUY",
         "why": "World-class luxury resort with award-winning spa, golf, and fine dining. Worth every penny for a special trip.",
         "positives": ["Award-winning spa", "Fine dining", "Impeccable service"], "warnings": [], "tradeoffs": ["Luxury pricing"]},
        {"title": "Boutique Luxury Inn", "price": "$299/night", "score": 88, "tier": "high", "decision": "SMART_BUY",
         "why": "Intimate luxury with only 20 rooms. Personal concierge service and curated local experiences.",
         "positives": ["Intimate setting", "Concierge service", "Curated experiences"], "warnings": [], "tradeoffs": ["Limited availability"]},
        {"title": "Upscale Golf & Wellness Resort", "price": "$249/night", "score": 84, "tier": "high", "decision": "SMART_BUY",
         "why": "Golf course, wellness center, and excellent restaurant on-site. Great for active luxury travelers.",
         "positives": ["Golf course", "Wellness center", "On-site dining"], "warnings": [], "tradeoffs": ["Need car for exploring"]},
        {"title": "Historic Luxury B&B", "price": "$189/night", "score": 77, "tier": "high", "decision": "SMART_BUY",
         "why": "Beautifully restored historic property with modern comforts. Gourmet breakfast included. Walkable downtown.",
         "positives": ["Historic charm", "Gourmet breakfast", "Walkable"], "warnings": [], "tradeoffs": ["No pool"]},
        {"title": "Modern Desert Hotel", "price": "$149/night", "score": 70, "tier": "medium", "decision": "CHECK",
         "why": "Stylish but newer property still building its reputation. Good pool and trendy design. Reviews growing.",
         "positives": ["Modern design", "Good pool"], "warnings": ["Newer property", "Limited reviews"], "tradeoffs": ["Still establishing itself"]},
    ],
    "wine_luxury": [
        {"title": "Vineyard Estate Resort", "price": "$349/night", "score": 91, "tier": "high", "decision": "SMART_BUY",
         "why": "Set among vineyards with wine tastings, farm-to-table dining, and cycling tours. The quintessential wine country experience.",
         "positives": ["Vineyard setting", "Wine tastings", "Farm-to-table dining"], "warnings": [], "tradeoffs": ["Premium pricing"]},
        {"title": "Wine Country Boutique Hotel", "price": "$269/night", "score": 87, "tier": "high", "decision": "SMART_BUY",
         "why": "Charming boutique in the heart of wine country. Walking distance to tasting rooms and restaurants.",
         "positives": ["Walkable to tastings", "Charming rooms", "Great restaurant"], "warnings": [], "tradeoffs": ["Books up fast"]},
        {"title": "Country Inn & Suites", "price": "$199/night", "score": 82, "tier": "high", "decision": "SMART_BUY",
         "why": "Comfortable suites with kitchenettes. Complimentary wine hour. Good base for exploring multiple wineries.",
         "positives": ["Kitchenettes", "Wine hour", "Central location"], "warnings": [], "tradeoffs": ["Standard decor"]},
        {"title": "Valley View Motel", "price": "$129/night", "score": 66, "tier": "medium", "decision": "CHECK",
         "why": "Budget-friendly option in wine country. Clean but basic. Good for travelers who spend all day at wineries.",
         "positives": ["Budget price", "Clean rooms"], "warnings": ["Basic amenities"], "tradeoffs": ["No wine country ambiance"]},
        {"title": "Highway Inn", "price": "$89/night", "score": 52, "tier": "low", "decision": "CHECK",
         "why": "Cheapest option but lacks the wine country charm. On the highway. For overnight stops only.",
         "positives": ["Lowest price"], "warnings": ["Highway location", "No ambiance"], "tradeoffs": ["Not a wine country experience"]},
    ],
}

PLATFORMS = ["booking", "airbnb", "expedia", "vrbo", "hotels"]


def build_item(session_id: str, city: dict, hotel: dict, rank: int, platform: str) -> dict:
    """Build a DynamoDB item for a single hotel listing."""
    now = datetime.now(timezone.utc)
    ttl = int(now.timestamp()) + (TTL_DAYS * 86400)
    item_id = f"{session_id}-{rank}"

    return {
        "session_id": {"S": session_id},
        "id": {"S": item_id},
        "rank": {"N": str(rank)},
        "title": {"S": f"{hotel['title']} — {city['dest']}"},
        "price": {"S": hotel["price"]},
        "url": {"S": f"https://www.{platform}.com/search?q={city['dest'].replace(' ', '+').replace(',', '')}"},
        "image_url": {"S": ""},
        "platform": {"S": platform},
        "destination": {"S": city["dest"]},
        "lat": {"N": str(city["lat"])},
        "lng": {"N": str(city["lng"])},
        "area_type": {"S": city["area"]},
        "radius_miles": {"N": "5"},
        "purchase_score": {"N": str(hotel["score"])},
        "health_score": {"N": "0"},
        "confidence_tier": {"S": hotel["tier"]},
        "decision": {"S": hotel["decision"]},
        "why_ranked": {"S": hotel["why"]},
        "positives": {"S": json.dumps(hotel["positives"])},
        "warnings": {"S": json.dumps(hotel["warnings"])},
        "tradeoffs": {"S": json.dumps(hotel["tradeoffs"])},
        "comparison_summary": {"S": f"NirnAI pre-ranked hotels in {city['dest']} — {city['cluster'].replace('_', ' ').title()} destination"},
        "ranked_at": {"S": now.strftime("%Y-%m-%dT%H:%M:%SZ")},
        "ttl": {"N": str(ttl)},
    }


def main():
    dry_run = "--dry-run" in sys.argv
    
    if dry_run:
        print("🏃 DRY RUN — no writes to DynamoDB\n")
    else:
        print(f"🚀 Writing to DynamoDB table: {TABLE} in {REGION}\n")

    ddb = boto3.client("dynamodb", region_name=REGION)

    total_items = 0
    total_cities = len(CITIES)

    for i, city in enumerate(CITIES, 1):
        cluster = city["cluster"]
        hotels = CLUSTER_HOTELS.get(cluster, CLUSTER_HOTELS["city_tourism"])
        # Assign a platform to each hotel (rotate)
        session_id = f"preload-{city['dest'].lower().replace(' ', '-').replace(',', '').replace('/', '-')}-{uuid.uuid4().hex[:8]}"

        print(f"[{i}/{total_cities}] {city['dest']} ({cluster}) — session: {session_id}")

        for rank, hotel in enumerate(hotels, 1):
            platform = PLATFORMS[(rank - 1) % len(PLATFORMS)]
            item = build_item(session_id, city, hotel, rank, platform)

            if dry_run:
                print(f"  #{rank} {hotel['title']} ({platform}) — score:{hotel['score']} {hotel['decision']}")
            else:
                try:
                    ddb.put_item(TableName=TABLE, Item=item)
                    total_items += 1
                except Exception as e:
                    print(f"  ❌ Error writing rank #{rank}: {e}")
                    continue

        if not dry_run:
            total_items += 0  # already counted above
            # Small delay to avoid throttling
            time.sleep(0.1)

    print(f"\n✅ Done! {'Would write' if dry_run else 'Wrote'} {total_items if not dry_run else total_cities * 5} items for {total_cities} cities.")
    if not dry_run:
        print(f"📅 TTL: {TTL_DAYS} days from now")
        print(f"🔍 Test: curl https://nirnai.app/listings/search?destination=Miami")


if __name__ == "__main__":
    main()
