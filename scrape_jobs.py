#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from scrapers.base_scraper import BaseScraper, CoverageReport, ScrapeRequest


def parse_brands(raw_brands: list[str]) -> list[str]:
    out: list[str] = []
    for chunk in raw_brands:
        for token in chunk.split(","):
            brand = token.strip()
            if brand:
                out.append(brand)
    return out


def slugify_location(value: str) -> str:
    lowered = value.strip().lower()
    lowered = re.sub(r"[^a-z0-9]+", "_", lowered)
    lowered = re.sub(r"_+", "_", lowered).strip("_")
    return lowered or "unknown_location"


def write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def print_summary(
    brand: str,
    source_url: str,
    jobs: list[dict],
    coverage: CoverageReport,
    output_file: Path,
) -> None:
    first_titles = [j.get("title", "") for j in jobs[:3]]
    print(f"Brand: {brand}")
    print(f"Source URL: {source_url}")
    print(f"Jobs extracted: {len(jobs)}")
    print(f"First 3 titles: {first_titles}")
    print(f"Detected parser type: {coverage.parser_type}")

    warning_block = coverage.warnings + coverage.selector_failures
    print(f"Warnings/fallbacks: {warning_block if warning_block else ['none']}")
    print(f"Output file: {output_file}")
    print("-")


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-brand restaurant jobs ingestion")
    parser.add_argument("--brand", action="append", default=[], help="Brand name (repeatable or comma-separated)")
    parser.add_argument("--jobs-url", default="", help="Optional jobs URL override for a single-brand run")
    parser.add_argument("--location", required=True, help='Search location, e.g. "Austin, TX"')
    parser.add_argument("--radius", type=int, default=None, help="Optional radius")
    parser.add_argument("--max-pages", type=int, default=3, help="Pagination depth")
    parser.add_argument("--timeout", type=int, default=20, help="Request timeout (seconds)")
    parser.add_argument("--retries", type=int, default=1, help="HTTP retries per request")
    parser.add_argument("--combined", action="store_true", help="Write data/combined_jobs.json")
    args = parser.parse_args()

    brands = parse_brands(args.brand)
    if not brands:
        raise SystemExit("At least one --brand is required")

    scraper = BaseScraper(timeout=max(5, args.timeout), retries=max(0, args.retries))
    all_jobs: list[dict] = []
    coverage_rows: list[dict] = []

    for brand in brands:
        req = ScrapeRequest(
            brand=brand,
            jobs_url=args.jobs_url if len(brands) == 1 else "",
            location=args.location,
            radius=args.radius,
            max_pages=args.max_pages,
        )

        output_file = Path("data") / f"{brand.lower()}_{slugify_location(args.location)}.json"

        try:
            result = scraper.scrape(req)
            jobs = result.jobs
            coverage = result.coverage
            all_jobs.extend(jobs)
        except Exception as exc:
            jobs = []
            coverage = CoverageReport(
                brand=brand,
                source_url=req.jobs_url or "auto-generated",
                parser_name="unresolved",
                parser_type="unresolved",
                used_fallback=True,
                warnings=[f"brand_run_failed: {exc}"],
            )

        write_json(output_file, jobs)
        print_summary(brand, coverage.source_url, jobs, coverage, output_file)

        coverage_rows.append(
            {
                "brand": brand,
                "source_url": coverage.source_url,
                "embedded_json_success": coverage.embedded_json_success,
                "embedded_json_hits": coverage.embedded_json_hits,
                "brand_specific_parser_usage": coverage.brand_specific_parser_usage,
                "detected_parser_type": coverage.parser_type,
                "parser_name": coverage.parser_name,
                "used_fallback": coverage.used_fallback,
                "selector_failures": coverage.selector_failures,
                "warnings": coverage.warnings,
                "api_endpoints_probed": coverage.api_endpoints_probed,
            }
        )

    write_json(Path("data") / "parser_coverage_report.json", coverage_rows)

    if args.combined or len(brands) > 1:
        write_json(Path("data") / "combined_jobs.json", all_jobs)


if __name__ == "__main__":
    main()
