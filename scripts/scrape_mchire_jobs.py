#!/usr/bin/env python3
"""Compatibility wrapper for the new multi-brand scrape framework."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from scrapers.base_scraper import BaseScraper, ScrapeRequest


def infer_location_from_url(url: str) -> str:
    try:
        parsed = urlparse(url)
        location_name = (parse_qs(parsed.query).get("location_name") or [""])[0]
        return location_name.replace("+", " ").strip()
    except Exception:
        return ""


def main() -> None:
    parser = argparse.ArgumentParser(description="Scrape McHire jobs and export normalized JSON")
    parser.add_argument("--url", default="", help="McHire search URL")
    parser.add_argument("--location-name", default="Austin, TX", help="Location name")
    parser.add_argument("--radius", type=int, default=None, help="Optional search radius")
    parser.add_argument("--out", default="data/mchire_jobs.json", help="Output file")
    args = parser.parse_args()

    location = args.location_name.strip() or infer_location_from_url(args.url.strip()) or "Austin, TX"

    req = ScrapeRequest(
        brand="mchire",
        jobs_url=args.url.strip(),
        location=location,
        radius=args.radius,
        max_pages=2,
    )

    scraper = BaseScraper()
    result = scraper.scrape(req)

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result.jobs, indent=2, ensure_ascii=False), encoding="utf-8")

    print("Brand: mchire")
    print(f"Source URL: {result.coverage.source_url}")
    print(f"Jobs extracted: {len(result.jobs)}")
    print(f"Detected parser type: {result.coverage.parser_type}")
    print(f"Output file: {output}")


if __name__ == "__main__":
    main()
