from __future__ import annotations

import re
from typing import Any, Iterable
from urllib.parse import quote_plus

from ..parser_registry import BrandParser


class GenericRestaurantParser(BrandParser):
    search_url_template = ""

    def build_jobs_url(self, location: str, radius: int | None = None) -> str:
        if not self.search_url_template:
            return ""

        encoded_location = quote_plus((location or "United States").strip())
        url = self.search_url_template.format(location=encoded_location)
        if radius is not None:
            joiner = "&" if "?" in url else "?"
            url = f"{url}{joiner}radius={int(radius)}"
        return url

    def parse_embedded_data(self, payload: Any, source_url: str, location: str) -> list[dict[str, Any]]:
        jobs = list(_extract_job_objects(payload))
        for job in jobs:
            job.setdefault("source_url", source_url)
            if location:
                job.setdefault("location", location)
        return jobs

    def parse_html(self, html: str, source_url: str, location: str) -> list[dict[str, Any]]:
        cards: list[dict[str, Any]] = []

        patterns = [
            r'<a[^>]+href="(?P<href>[^"]*(?:job|career|position)[^"]*)"[^>]*>(?P<title>[^<]{4,140})</a>',
            r'<h[1-4][^>]*>(?P<title>[^<]{4,140})</h[1-4]>',
        ]

        for pattern in patterns:
            for match in re.finditer(pattern, html, flags=re.IGNORECASE):
                title = _clean(match.group("title"))
                if not _jobish(title):
                    continue

                href = match.groupdict().get("href")
                row = {
                    "title": title,
                    "description": title,
                    "location": location,
                    "source_url": source_url,
                }
                if href:
                    row["source_url"] = href if href.startswith("http") else source_url
                cards.append(row)

        return cards

    def discover_api_endpoints(self, html: str, source_url: str) -> list[str]:
        del source_url
        endpoints = set()

        patterns = [
            r'https?://[^"\']*(?:api|graphql|jobs|requisitions)[^"\']*',
            r'"((?:/|https?://)[^"\']*(?:api|graphql|jobs|requisitions)[^"\']*)"',
        ]
        for pattern in patterns:
            for match in re.findall(pattern, html, flags=re.IGNORECASE):
                if isinstance(match, tuple):
                    continue
                endpoints.add(match)

        return sorted(endpoints)

    def next_page_urls(self, current_url: str, html: str, page: int) -> list[str]:
        del html
        joiner = "&" if "?" in current_url else "?"
        return [f"{current_url}{joiner}page={page + 1}"]


def _clean(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _jobish(title: str) -> bool:
    text = (title or "").lower()
    return any(
        token in text
        for token in (
            "barista",
            "crew",
            "cashier",
            "manager",
            "team member",
            "cook",
            "shift",
            "driver",
            "restaurant",
            "associate",
            "member",
        )
    )


def _extract_job_objects(payload: Any) -> Iterable[dict[str, Any]]:
    if isinstance(payload, list):
        for item in payload:
            yield from _extract_job_objects(item)
        return

    if not isinstance(payload, dict):
        return

    keys = {str(k).lower() for k in payload.keys()}
    markers = {"title", "jobtitle", "position", "positiontitle", "requisition", "jobid"}
    if keys & markers:
        yield payload

    for value in payload.values():
        yield from _extract_job_objects(value)
