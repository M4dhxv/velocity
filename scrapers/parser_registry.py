from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import urlparse


@dataclass
class ParserDetection:
    parser_name: str
    parser_type: str
    used_fallback: bool


class BrandParser:
    """Brand adapter interface. Subclasses can override any parser hook."""

    brand = "generic"
    aliases: tuple[str, ...] = ()
    domains: tuple[str, ...] = ()

    def matches_brand(self, brand_name: str) -> bool:
        value = (brand_name or "").strip().lower()
        return value == self.brand or value in self.aliases

    def matches_url(self, url: str) -> bool:
        if not url:
            return False
        host = (urlparse(url).netloc or "").lower()
        return any(domain in host for domain in self.domains)

    def build_jobs_url(self, location: str, radius: int | None = None) -> str:
        del radius
        return ""

    def parse_embedded_data(self, payload: Any, source_url: str, location: str) -> list[dict[str, Any]]:
        del payload, source_url, location
        return []

    def parse_api_payload(self, payload: Any, source_url: str, location: str) -> list[dict[str, Any]]:
        return self.parse_embedded_data(payload, source_url, location)

    def custom_api_jobs(
        self,
        session: Any,
        source_url: str,
        html: str,
        location: str,
        timeout: int,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        del session, source_url, html, location, timeout
        return [], []

    def parse_html(self, html: str, source_url: str, location: str) -> list[dict[str, Any]]:
        del html, source_url, location
        return []

    def discover_api_endpoints(self, html: str, source_url: str) -> list[str]:
        del source_url
        endpoints: set[str] = set()
        for match in re.findall(r'https?://[^"\']+(?:api|graphql|jobs)[^"\']*', html, flags=re.IGNORECASE):
            endpoints.add(match)
        for match in re.findall(r'"((?:/|https?://)[^"\']*(?:api|graphql|jobs)[^"\']*)"', html, flags=re.IGNORECASE):
            endpoints.add(match)
        return sorted(endpoints)

    def next_page_urls(self, current_url: str, html: str, page: int) -> list[str]:
        del current_url, html, page
        return []


class FallbackParser(BrandParser):
    brand = "fallback"

    def parse_embedded_data(self, payload: Any, source_url: str, location: str) -> list[dict[str, Any]]:
        jobs = list(_find_job_objects(payload))
        for job in jobs:
            job.setdefault("source_url", source_url)
            if location:
                job.setdefault("location", location)
        return jobs

    def parse_html(self, html: str, source_url: str, location: str) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []
        pattern = re.compile(
            r'<a[^>]+href="(?P<href>[^\"]+)"[^>]*>(?P<title>[^<]{4,140})</a>',
            flags=re.IGNORECASE,
        )
        for match in pattern.finditer(html):
            title = _clean_text(match.group("title"))
            href = match.group("href")
            if not _looks_like_job_title(title):
                continue
            cards.append({
                "title": title,
                "source_url": href if href.startswith("http") else f"{source_url.rstrip('/')}/{href.lstrip('/')}",
                "location": location,
            })
        return cards


class ParserRegistry:
    def __init__(self) -> None:
        self._parsers: list[BrandParser] = []
        self._fallback = FallbackParser()

    def register(self, parser: BrandParser) -> None:
        self._parsers.append(parser)

    def detect_parser(self, brand: str, jobs_url: str, html: str = "") -> tuple[BrandParser, ParserDetection]:
        parser_type = _detect_parser_type(html)

        for parser in self._parsers:
            if brand and parser.matches_brand(brand):
                return parser, ParserDetection(parser.brand, parser_type, False)

        for parser in self._parsers:
            if jobs_url and parser.matches_url(jobs_url):
                return parser, ParserDetection(parser.brand, parser_type, False)

        return self._fallback, ParserDetection(self._fallback.brand, parser_type, True)

    def all_parser_names(self) -> list[str]:
        return [p.brand for p in self._parsers] + [self._fallback.brand]


_JOB_KEYS = {"title", "jobtitle", "position", "positiontitle", "requisition", "jobid"}


def _clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _looks_like_job_title(value: str) -> bool:
    s = (value or "").strip()
    if len(s) < 3:
        return False
    words = s.lower()
    return any(k in words for k in ("crew", "barista", "manager", "member", "associate", "cook", "shift", "driver", "cashier"))


def _find_job_objects(payload: Any) -> Iterable[dict[str, Any]]:
    if isinstance(payload, list):
        for item in payload:
            yield from _find_job_objects(item)
        return

    if not isinstance(payload, dict):
        return

    lowered_keys = {str(k).lower() for k in payload.keys()}
    if lowered_keys & _JOB_KEYS:
        yield payload

    for value in payload.values():
        yield from _find_job_objects(value)


def _detect_parser_type(html: str) -> str:
    checks = [
        ("window.PRELOAD_STATE", "window.PRELOAD_STATE"),
        ("window.__PRELOAD_STATE__", "window.PRELOAD_STATE"),
        ("__NEXT_DATA__", "__NEXT_DATA__"),
        ("application/ld+json", "JSON-LD"),
    ]
    for marker, label in checks:
        if marker in html:
            return label

    if re.search(r"window\.[A-Za-z0-9_]*(STATE|DATA)\s*=", html):
        return "inline_script_state"

    if re.search(r"(?:api|graphql|jobs)/", html, flags=re.IGNORECASE):
        return "api_or_xhr"

    return "html_only"


def build_registry() -> ParserRegistry:
    registry = ParserRegistry()

    # Local imports avoid circular dependencies.
    from .brands.burger_king import BurgerKingParser
    from .brands.chipotle import ChipotleParser
    from .brands.dominos import DominosParser
    from .brands.mchire import McHireParser
    from .brands.starbucks import StarbucksParser
    from .brands.subway import SubwayParser
    from .brands.tacobell import TacoBellParser
    from .brands.wendys import WendysParser

    for parser in (
        McHireParser(),
        StarbucksParser(),
        ChipotleParser(),
        SubwayParser(),
        TacoBellParser(),
        WendysParser(),
        BurgerKingParser(),
        DominosParser(),
    ):
        registry.register(parser)

    return registry
