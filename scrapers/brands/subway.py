from __future__ import annotations

from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .common import GenericRestaurantParser


class SubwayParser(GenericRestaurantParser):
    brand = "subway"
    domains = ("careers.subway.com", "jobs.subway.com")
    search_url_template = "https://jobs.subway.com/us/en"

    def discover_api_endpoints(self, html: str, source_url: str) -> list[str]:
        del html
        if "harri.com" in source_url.lower():
            return []
        return super().discover_api_endpoints(html, source_url)

    def custom_api_jobs(
        self,
        session: Any,
        source_url: str,
        html: str,
        location: str,
        timeout: int,
    ) -> tuple[list[dict[str, Any]], list[str]]:
        del html
        if "harri.com" not in source_url.lower():
            return [], []

        phrase = _extract_jobs_phrase(source_url) or location or "new york"
        if "subway" not in phrase.lower():
            phrase = f"subway {phrase}".strip()

        body = {
            "search_phrase": phrase,
            "size": 100,
            "radius": 100,
            "start": 0,
            "hecs": [],
            "positions": [],
            "availability": [],
            "cuisines": [],
            "skills": [],
            "degrees": [],
            "categories": [],
            "sort": ["publish_date"],
            "sort_type": "desc",
            "source": "web",
        }
        headers = {
            "Accept": "application/json, text/plain, */*",
            "Content-Type": "application/json",
            "Origin": "https://harri.com",
            "Referer": source_url,
        }
        response = session.post(
            "https://gateway.harri.com/core/api/v1/harri_search/search_jobs",
            json=body,
            headers=headers,
            timeout=timeout,
        )
        response.raise_for_status()

        payload = response.json()
        rows = ((payload.get("data") or {}).get("results") or [])
        jobs: list[dict[str, Any]] = []
        for row in rows:
            brand_name = str(((row.get("brand") or {}).get("name") or "")).strip()
            if "subway" not in brand_name.lower():
                continue

            location_data = ((row.get("locations") or [{}])[0]) if row.get("locations") else {}
            formatted_address = str(location_data.get("formatted_address") or "").strip()

            position_name = str(
                (row.get("aliasPosition") or (row.get("position") or {}).get("name") or "Subway role")
            ).strip()
            hecs = [str(x).strip() for x in (row.get("hecs") or []) if str(x).strip()]
            cuisines = [str(x).strip() for x in (row.get("cuisines") or []) if str(x).strip()]
            comp = row.get("compensation") or {}
            rate = comp.get("rate") or {}

            job: dict[str, Any] = {
                "title": position_name,
                "description": f"{position_name} at {brand_name}",
                "skills": [*hecs, *cuisines],
                "location": formatted_address or location,
                "source_url": f"https://harri.com/mysubwaycareer/jobs/{row.get('id')}",
                "source_id": str(row.get("id") or ""),
                "postedAt": row.get("publishTime") or row.get("createdTime"),
            }
            if str((rate.get("code") or "")).upper() == "PER_HOUR":
                job["hourlyRateMin"] = comp.get("compensation_from")
                job["hourlyRateMax"] = comp.get("compensation_to") or comp.get("compensation_from")

            jobs.append(job)

        return jobs, []


def _extract_jobs_phrase(url: str) -> str:
    parsed = urlparse(url)
    raw_filters = (parse_qs(parsed.query).get("filters") or [""])[0]
    if not raw_filters:
        return ""

    # Harri links often double-encode query strings.
    decoded = unquote(unquote(raw_filters))
    params = parse_qs(decoded)
    phrase = (params.get("jobsPhrase") or [""])[0]
    return str(phrase).strip()
