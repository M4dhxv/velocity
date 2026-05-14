"""Reusable multi-brand restaurant jobs scraping framework."""

from .base_scraper import BaseScraper, CoverageReport, ScrapeRequest
from .parser_registry import ParserRegistry, build_registry

__all__ = [
    "BaseScraper",
    "CoverageReport",
    "ScrapeRequest",
    "ParserRegistry",
    "build_registry",
]
