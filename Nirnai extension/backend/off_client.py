"""Open Food Facts client — fallback enrichment for health data."""

from __future__ import annotations

import urllib.parse
from typing import Optional

import httpx

OFF_API = "https://world.openfoodfacts.org/api/v2"
OFF_SEARCH = "https://world.openfoodfacts.org/cgi/search.pl"


async def lookup_by_barcode(barcode: str) -> Optional[dict]:
    """Look up a product by barcode on Open Food Facts."""
    if not barcode or not barcode.strip():
        return None

    url = f"{OFF_API}/product/{urllib.parse.quote(barcode)}.json"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        if resp.status_code != 200:
            return None
        data = resp.json()
        if data.get("status") != 1:
            return None
        return _extract_off_data(data.get("product", {}))


async def search_by_name(product_name: str) -> Optional[dict]:
    """Search Open Food Facts by product name (best effort)."""
    if not product_name or not product_name.strip():
        return None

    params = {
        "search_terms": product_name,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": 1,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(OFF_SEARCH, params=params)
        if resp.status_code != 200:
            return None
        data = resp.json()
        products = data.get("products", [])
        if not products:
            return None
        return _extract_off_data(products[0])


def _extract_off_data(product: dict) -> dict:
    """Extract relevant fields from an Open Food Facts product object."""
    nutriments = product.get("nutriments", {})

    return {
        "name": product.get("product_name", ""),
        "brands": product.get("brands", ""),
        "ingredients_text": product.get("ingredients_text", ""),
        "nutrition": {
            "calories": nutriments.get("energy-kcal_100g"),
            "fat_g": nutriments.get("fat_100g"),
            "saturated_fat_g": nutriments.get("saturated-fat_100g"),
            "sodium_mg": _to_mg(nutriments.get("sodium_100g")),
            "sugar_g": nutriments.get("sugars_100g"),
            "protein_g": nutriments.get("proteins_100g"),
            "fiber_g": nutriments.get("fiber_100g"),
        },
        "nova_group": product.get("nova_group"),
        "nutriscore_grade": product.get("nutriscore_grade"),
        "labels": product.get("labels", ""),
        "additives_tags": product.get("additives_tags", []),
    }


def _to_mg(sodium_g) -> Optional[float]:
    """Convert sodium in grams to milligrams."""
    if sodium_g is None:
        return None
    return round(float(sodium_g) * 1000, 1)
