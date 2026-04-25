//! Server-side URL scraper for extracting listing data from product/travel pages.
//! Uses meta tags, JSON-LD, and HTML patterns to populate ProductData.

use regex::Regex;
use scraper::{Html, Selector};
use tracing::warn;

use crate::nirnai::ProductData;

/// Fetch a URL and extract listing data from the HTML.
pub async fn scrape_url(url: &str) -> Result<ProductData, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let resp = client
        .get(url)
        .header("Accept", "text/html,application/xhtml+xml")
        .header("Accept-Language", "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch URL: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let html = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    let source_site = detect_site(url);
    let mut data = extract_from_html(&html, url, &source_site);
    data.url = url.to_string();
    data.source_site = source_site.clone();
    data.page_type = if is_travel(&source_site) {
        "travel".into()
    } else {
        "product".into()
    };

    // Extract search context from URL params for travel sites
    if is_travel(&source_site) {
        data.barcode = extract_search_context(url);
    }

    Ok(data)
}

fn extract_from_html(html: &str, url: &str, source_site: &str) -> ProductData {
    let doc = Html::parse_document(html);
    let mut data = ProductData::default();

    // ── 1. Meta tags ──
    extract_meta_tags(&doc, &mut data);

    // ── 2. JSON-LD ──
    extract_json_ld(&doc, &mut data);

    // ── 3. Site-specific extraction ──
    match source_site {
        "airbnb" => extract_airbnb(&doc, html, url, &mut data),
        "booking" => extract_booking(&doc, html, &mut data),
        "amazon" => extract_amazon(&doc, html, &mut data),
        "homedepot" => extract_homedepot(&doc, &mut data),
        _ => {}
    }

    data
}

/// Extract Open Graph and other meta tags.
fn extract_meta_tags(doc: &Html, data: &mut ProductData) {
    let meta_sel = Selector::parse("meta").unwrap();

    for el in doc.select(&meta_sel) {
        let property = el.value().attr("property").unwrap_or("");
        let name = el.value().attr("name").unwrap_or("");
        let content = el.value().attr("content").unwrap_or("");

        if content.is_empty() {
            continue;
        }

        match property {
            "og:title" => {
                if data.title.is_empty() {
                    data.title = content.to_string();
                }
            }
            "og:image" => {
                if data.image_url.is_empty() {
                    data.image_url = content.to_string();
                }
            }
            "og:description" => {
                if data.category.is_empty() || !data.category.contains("Description:") {
                    let existing = data.category.clone();
                    if existing.is_empty() {
                        data.category = format!("Description: {}", content);
                    } else {
                        data.category = format!("{} | Description: {}", existing, content);
                    }
                }
            }
            _ => {}
        }

        // Airbnb-specific meta
        if name == "airbedandbreakfast:price" || property == "airbedandbreakfast:price" {
            if data.price.is_empty() {
                data.price = content.to_string();
            }
        }
    }
}

/// Extract structured data from JSON-LD scripts.
fn extract_json_ld(doc: &Html, data: &mut ProductData) {
    let script_sel = Selector::parse(r#"script[type="application/ld+json"]"#).unwrap();

    for el in doc.select(&script_sel) {
        let text = el.text().collect::<String>();
        let parsed: serde_json::Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Handle @graph arrays
        let items: Vec<&serde_json::Value> = if let Some(graph) = parsed.get("@graph") {
            graph.as_array().map(|a| a.iter().collect()).unwrap_or_default()
        } else {
            vec![&parsed]
        };

        for item in items {
            // Title
            if data.title.is_empty() {
                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                    data.title = name.to_string();
                }
            }

            // Image
            if data.image_url.is_empty() {
                if let Some(img) = item.get("image") {
                    if let Some(s) = img.as_str() {
                        data.image_url = s.to_string();
                    } else if let Some(arr) = img.as_array() {
                        if let Some(first) = arr.first().and_then(|v| v.as_str()) {
                            data.image_url = first.to_string();
                        }
                    }
                }
            }

            // Price from offers
            if data.price.is_empty() {
                if let Some(offers) = item.get("offers") {
                    let offer = if offers.is_array() {
                        offers.as_array().and_then(|a| a.first())
                    } else {
                        Some(offers)
                    };
                    if let Some(o) = offer {
                        if let Some(p) = o.get("price").and_then(|v| v.as_str().or_else(|| v.as_f64().map(|_| "")).or(Some(""))) {
                            let price_str = o.get("price").map(|v| v.to_string().trim_matches('"').to_string()).unwrap_or_default();
                            if !price_str.is_empty() {
                                let currency = o.get("priceCurrency").and_then(|v| v.as_str()).unwrap_or("");
                                data.price = if currency.is_empty() {
                                    price_str
                                } else {
                                    format!("{} {}", price_str, currency)
                                };
                                if data.currency.is_empty() && !currency.is_empty() {
                                    data.currency = currency.to_string();
                                }
                            }
                            let _ = p;
                        }
                    }
                }
            }

            // Rating
            if data.rating.is_empty() {
                if let Some(agg) = item.get("aggregateRating") {
                    if let Some(r) = agg.get("ratingValue") {
                        data.rating = r.to_string().trim_matches('"').to_string();
                    }
                    if data.review_count.is_empty() {
                        if let Some(rc) = agg.get("reviewCount").or_else(|| agg.get("ratingCount")) {
                            data.review_count = rc.to_string().trim_matches('"').to_string();
                        }
                    }
                }
            }

            // Description
            if let Some(desc) = item.get("description").and_then(|v| v.as_str()) {
                if !data.category.contains("Description:") {
                    let existing = data.category.clone();
                    if existing.is_empty() {
                        data.category = format!("Description: {}", truncate(desc, 300));
                    } else {
                        data.category =
                            format!("{} | Description: {}", existing, truncate(desc, 300));
                    }
                }
            }

            // Address (for travel)
            if let Some(addr) = item.get("address") {
                if let Some(locality) = addr.get("addressLocality").and_then(|v| v.as_str()) {
                    let region = addr.get("addressRegion").and_then(|v| v.as_str()).unwrap_or("");
                    if data.delivery.is_empty() {
                        data.delivery = if region.is_empty() {
                            format!("Location: {}", locality)
                        } else {
                            format!("Location: {}, {}", locality, region)
                        };
                    }
                }
            }
        }
    }
}

/// Airbnb-specific extraction from HTML content.
fn extract_airbnb(doc: &Html, html: &str, url: &str, data: &mut ProductData) {
    // Price from booking widget
    if data.price.is_empty() {
        if let Ok(sel) = Selector::parse("[data-testid='book-it-default']") {
            if let Some(el) = doc.select(&sel).next() {
                let text = el.text().collect::<String>();
                if let Some(cap) = Regex::new(r"[\$€£¥₹]\s*(\d[\d,]*)").ok().and_then(|re| re.captures(&text)) {
                    data.price = cap[0].to_string();
                }
            }
        }
    }

    // Title from Airbnb section
    if data.title.is_empty() || data.title.contains("Airbnb") {
        if let Ok(sel) = Selector::parse("[data-section-id='TITLE_DEFAULT'] h1, [data-section-id='TITLE_DEFAULT'] span") {
            for el in doc.select(&sel) {
                let text = el.text().collect::<String>().trim().to_string();
                if !text.is_empty() && text.len() > 5 {
                    data.title = text;
                    break;
                }
            }
        }
    }

    // Rating from reviews section or header
    if data.rating.is_empty() {
        let rating_re = Regex::new(r"(\d\.\d{1,2})\s*(?:·|•)").ok();
        if let Some(re) = &rating_re {
            if let Some(cap) = re.captures(html) {
                data.rating = cap[1].to_string();
            }
        }
    }

    // Review count
    if data.review_count.is_empty() {
        let review_re = Regex::new(r"(\d[\d,]*)\s*reviews?").ok();
        if let Some(re) = &review_re {
            if let Some(cap) = re.captures(html) {
                data.review_count = cap[1].replace(',', "");
            }
        }
    }

    // Host info
    if data.seller.is_empty() {
        let host_re = Regex::new(r"Hosted by\s+([A-Z][a-zA-Z\s]+)").ok();
        if let Some(re) = &host_re {
            if let Some(cap) = re.captures(html) {
                data.seller = cap[1].trim().to_string();
            }
        }
    }

    // Superhost status & host credentials
    if data.fulfiller.is_empty() {
        let mut host_info: Vec<String> = Vec::new();
        if html.contains("Guest favorite") || html.contains("guest favorite") || html.contains("Guest Favorite") {
            host_info.push("Guest Favorite".to_string());
        }
        if html.contains("Superhost") {
            host_info.push("Superhost".to_string());
        }
        if html.contains("identity verified") || html.contains("Identity verified") {
            host_info.push("Identity verified".to_string());
        }
        // Years hosting
        if let Some(re) = Regex::new(r"(\d+)\s*years?\s*hosting").ok() {
            if let Some(cap) = re.captures(html) {
                host_info.push(format!("{} years hosting", &cap[1]));
            }
        }
        if !host_info.is_empty() {
            data.fulfiller = host_info.join(", ");
        }
    }

    // Amenities
    if data.ingredients.is_empty() {
        if let Ok(sel) = Selector::parse("[data-section-id='AMENITIES_DEFAULT']") {
            if let Some(section) = doc.select(&sel).next() {
                let text = section.text().collect::<String>();
                // Extract amenity names
                let amenity_re = Regex::new(r"(?:Wifi|Pool|Kitchen|Air conditioning|Heating|Washer|Dryer|Free parking|TV|Hot tub|Gym|EV charger|Fireplace|BBQ|Pet[- ]friendly|Self check-in|Workspace|Coffee maker|Dishwasher|Microwave|Elevator|Ocean view|Mountain view|Lake view|Garden view|Patio|Balcony|Beach access|Waterfront)").ok();
                if let Some(re) = amenity_re {
                    let amenities: Vec<&str> = re.find_iter(&text).map(|m| m.as_str()).collect();
                    if !amenities.is_empty() {
                        data.ingredients = amenities.join(", ");
                    }
                }
            }
        }
    }

    // Cancellation policy
    if data.return_policy.is_empty() {
        if html.contains("free cancellation") || html.contains("Free cancellation") {
            let cancel_re = Regex::new(r"[Ff]ree cancellation\s*(?:before|until)?\s*([A-Z][a-z]+ \d+)?").ok();
            if let Some(re) = &cancel_re {
                if let Some(cap) = re.captures(html) {
                    data.return_policy = cap[0].to_string();
                }
            } else {
                data.return_policy = "Free cancellation available".to_string();
            }
        }
    }

    // Property type
    let existing_cat = data.category.clone();
    let prop_types = ["Entire home", "Entire apartment", "Private room", "Shared room", "Entire villa", "Entire condo", "Entire cottage", "Entire cabin", "Entire loft", "Entire bungalow"];
    for pt in prop_types {
        if html.contains(pt) {
            if !existing_cat.contains(pt) {
                data.category = if existing_cat.is_empty() {
                    pt.to_string()
                } else {
                    format!("{} | {}", pt, existing_cat)
                };
            }
            break;
        }
    }

    // Beds/bedrooms/baths from overview
    let specs_re = Regex::new(r"(\d+)\s*(?:guests?|bedrooms?|beds?|baths?|bathrooms?)").ok();
    if let Some(re) = specs_re {
        let specs: Vec<String> = re.find_iter(html).take(6).map(|m| m.as_str().to_string()).collect();
        if !specs.is_empty() && data.delivery.is_empty() {
            data.delivery = specs.join(" · ");
        }
    }

    // Tax included
    data.tax_included = html.contains("total before taxes") || html.contains("Total before taxes");

    // Currency from URL or symbols
    if data.currency.is_empty() {
        if let Some(c) = extract_url_param(url, "currency") {
            data.currency = c;
        } else if html.contains('$') {
            data.currency = "USD".to_string();
        } else if html.contains('€') {
            data.currency = "EUR".to_string();
        } else if html.contains('£') {
            data.currency = "GBP".to_string();
        }
    }
}

/// Booking.com-specific extraction.
fn extract_booking(_doc: &Html, html: &str, data: &mut ProductData) {
    // Rating
    if data.rating.is_empty() {
        let rating_re = Regex::new(r"Scored\s+(\d+\.?\d*)\s").ok();
        if let Some(re) = &rating_re {
            if let Some(cap) = re.captures(html) {
                data.rating = cap[1].to_string();
            }
        }
    }

    // Review count
    if data.review_count.is_empty() {
        let re = Regex::new(r"([\d,]+)\s*(?:reviews?|verified guest reviews)").ok();
        if let Some(re) = &re {
            if let Some(cap) = re.captures(html) {
                data.review_count = cap[1].replace(',', "");
            }
        }
    }

    // Property category ratings
    if data.nutrition_info.is_empty() {
        let cats = ["Staff", "Facilities", "Cleanliness", "Comfort", "Value for money", "Location", "Free WiFi"];
        let mut found = Vec::new();
        for cat in cats {
            let pattern = format!(r"{}[:\s]+(\d+\.?\d*)", regex::escape(cat));
            if let Some(re) = Regex::new(&pattern).ok() {
                if let Some(cap) = re.captures(html) {
                    found.push(format!("{}: {}", cat, &cap[1]));
                }
            }
        }
        if !found.is_empty() {
            data.nutrition_info = found.join(", ");
        }
    }
}

/// Amazon-specific extraction.
fn extract_amazon(doc: &Html, _html: &str, data: &mut ProductData) {
    // Title from #productTitle
    if data.title.is_empty() {
        if let Ok(sel) = Selector::parse("#productTitle") {
            if let Some(el) = doc.select(&sel).next() {
                data.title = el.text().collect::<String>().trim().to_string();
            }
        }
    }

    // Price
    if data.price.is_empty() {
        if let Ok(sel) = Selector::parse(".a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice, .priceToPay .a-offscreen") {
            if let Some(el) = doc.select(&sel).next() {
                data.price = el.text().collect::<String>().trim().to_string();
            }
        }
    }

    // Rating
    if data.rating.is_empty() {
        if let Ok(sel) = Selector::parse("#acrPopover .a-icon-alt, [data-hook='rating-out-of-text']") {
            if let Some(el) = doc.select(&sel).next() {
                let text = el.text().collect::<String>();
                if let Some(re) = Regex::new(r"(\d\.?\d?)\s*out of\s*5").ok() {
                    if let Some(cap) = re.captures(&text) {
                        data.rating = cap[1].to_string();
                    }
                }
            }
        }
    }

    // Review count
    if data.review_count.is_empty() {
        if let Ok(sel) = Selector::parse("#acrCustomerReviewText") {
            if let Some(el) = doc.select(&sel).next() {
                let text = el.text().collect::<String>();
                if let Some(re) = Regex::new(r"([\d,]+)\s*(?:global\s*)?ratings?").ok() {
                    if let Some(cap) = re.captures(&text) {
                        data.review_count = cap[1].replace(',', "");
                    }
                }
            }
        }
    }

    // Brand
    if data.brand.is_empty() {
        if let Ok(sel) = Selector::parse("#bylineInfo, .po-brand .a-span9 .a-size-base") {
            if let Some(el) = doc.select(&sel).next() {
                data.brand = el.text().collect::<String>().trim()
                    .trim_start_matches("Brand: ")
                    .trim_start_matches("Visit the ")
                    .trim_end_matches(" Store")
                    .to_string();
            }
        }
    }

    // Seller
    if data.seller.is_empty() {
        if let Ok(sel) = Selector::parse("#merchant-info, #sellerProfileTriggerId") {
            if let Some(el) = doc.select(&sel).next() {
                data.seller = el.text().collect::<String>().trim().to_string();
            }
        }
    }
}

/// Home Depot-specific extraction.
fn extract_homedepot(doc: &Html, data: &mut ProductData) {
    // Title
    if data.title.is_empty() {
        if let Ok(sel) = Selector::parse("[data-testid='product-title'], .product-details__badge-title--wrapper h1, .mainTitle, h1.product-title") {
            if let Some(el) = doc.select(&sel).next() {
                data.title = el.text().collect::<String>().trim().to_string();
            }
        }
    }

    // Price — Home Depot uses multiple selector patterns
    if data.price.is_empty() {
        let selectors = [
            "[data-testid='price-value']",
            ".price-format__main-price",
            ".price .price-format__large",
            "[data-testid='standard-price']",
            ".price-detailed__main-price",
            "#standard-price",
            ".buybox__price",
        ];
        for sel_str in selectors {
            if let Ok(sel) = Selector::parse(sel_str) {
                if let Some(el) = doc.select(&sel).next() {
                    let text = el.text().collect::<String>().trim().to_string();
                    if !text.is_empty() {
                        // Clean up price: extract dollar amount
                        if let Some(re) = Regex::new(r"\$[\d,]+\.?\d*").ok() {
                            if let Some(m) = re.find(&text) {
                                data.price = m.as_str().to_string();
                                break;
                            }
                        }
                        data.price = text;
                        break;
                    }
                }
            }
        }
    }

    // Rating
    if data.rating.is_empty() {
        if let Ok(sel) = Selector::parse("[itemprop='ratingValue'], .ratings-and-reviews__stars--num") {
            if let Some(el) = doc.select(&sel).next() {
                data.rating = el.text().collect::<String>().trim().to_string();
            }
        }
    }

    // Review count
    if data.review_count.is_empty() {
        if let Ok(sel) = Selector::parse("[itemprop='reviewCount'], .ratings-and-reviews__count") {
            if let Some(el) = doc.select(&sel).next() {
                let text = el.text().collect::<String>().trim().replace(['(', ')'], "");
                data.review_count = text;
            }
        }
    }

    // Brand
    if data.brand.is_empty() {
        if let Ok(sel) = Selector::parse(".product-details__brand--link, [data-testid='product-brand'], .brand-link") {
            if let Some(el) = doc.select(&sel).next() {
                data.brand = el.text().collect::<String>().trim().to_string();
            }
        }
    }

    // Set seller
    if data.seller.is_empty() {
        data.seller = "Home Depot".to_string();
    }
    if data.fulfiller.is_empty() {
        data.fulfiller = "Home Depot".to_string();
    }
}

// ── Utility functions ──

fn detect_site(url: &str) -> String {
    let u = url.to_lowercase();
    let sites = [
        ("airbnb", "airbnb"), ("booking.com", "booking"), ("expedia", "expedia"),
        ("vrbo", "vrbo"), ("hotels.com", "hotels"), ("tripadvisor", "tripadvisor"),
        ("amazon", "amazon"), ("walmart", "walmart"), ("target.com", "target"),
        ("bestbuy", "bestbuy"), ("ebay", "ebay"), ("costco", "costco"),
        ("etsy", "etsy"), ("wayfair", "wayfair"),
        ("homedepot", "homedepot"), ("lowes", "lowes"),
    ];
    for (pattern, name) in sites {
        if u.contains(pattern) { return name.to_string(); }
    }
    "unknown".to_string()
}

fn is_travel(source: &str) -> bool {
    matches!(source, "airbnb" | "booking" | "expedia" | "vrbo" | "hotels" | "tripadvisor"
        | "agoda" | "makemytrip" | "goibibo" | "ixigo" | "cleartrip" | "yatra" | "easemytrip")
}

/// Extract search context from Airbnb/travel URL parameters.
fn extract_search_context(url: &str) -> String {
    let mut parts = Vec::new();

    if let Some(v) = extract_url_param(url, "check_in").or_else(|| extract_url_param(url, "checkin")) {
        parts.push(format!("check_in={}", v));
    }
    if let Some(v) = extract_url_param(url, "check_out").or_else(|| extract_url_param(url, "checkout")) {
        parts.push(format!("check_out={}", v));
    }
    if let Some(v) = extract_url_param(url, "adults").or_else(|| extract_url_param(url, "group_adults")) {
        parts.push(format!("adults={}", v));
    }
    if let Some(v) = extract_url_param(url, "children").or_else(|| extract_url_param(url, "group_children")) {
        parts.push(format!("children={}", v));
    }
    if let Some(v) = extract_url_param(url, "location").or_else(|| extract_url_param(url, "ss")) {
        parts.push(format!("location={}", v));
    }

    parts.join("; ")
}

fn extract_url_param(url: &str, param: &str) -> Option<String> {
    let query = url.split('?').nth(1)?;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        if kv.next()? == param {
            return kv.next().map(|v| urldecode(v));
        }
    }
    None
}

fn urldecode(s: &str) -> String {
    s.replace('+', " ")
        .replace("%20", " ")
        .replace("%2C", ",")
        .replace("%2F", "/")
        .replace("%3A", ":")
        .replace("%26", "&")
        .replace("%3D", "=")
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}

impl Default for ProductData {
    fn default() -> Self {
        Self {
            title: String::new(),
            brand: String::new(),
            price: String::new(),
            currency: String::new(),
            rating: String::new(),
            review_count: String::new(),
            seller: String::new(),
            fulfiller: String::new(),
            ingredients: String::new(),
            nutrition_info: String::new(),
            return_policy: String::new(),
            delivery: String::new(),
            category: String::new(),
            url: String::new(),
            image_url: String::new(),
            barcode: String::new(),
            source_site: String::new(),
            page_type: String::new(),
            country_code: String::new(),
            currency_code: String::new(),
            locale: String::new(),
            tax_included: false,
            shipping_region: String::new(),
            measurement_system: String::new(),
        }
    }
}
