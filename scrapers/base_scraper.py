from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode, urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .parser_registry import BrandParser, ParserDetection, build_registry

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

DEFAULT_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


@dataclass
class ScrapeRequest:
    brand: str
    jobs_url: str = ""
    location: str = ""
    radius: int | None = None
    max_pages: int = 3


@dataclass
class CoverageReport:
    brand: str
    source_url: str
    parser_name: str = ""
    parser_type: str = ""
    used_fallback: bool = False
    embedded_json_success: bool = False
    embedded_json_hits: int = 0
    api_endpoints_probed: list[str] = field(default_factory=list)
    brand_specific_parser_usage: bool = False
    selector_failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ScrapeResult:
    request: ScrapeRequest
    jobs: list[dict[str, Any]]
    coverage: CoverageReport


class BaseScraper:
    def __init__(self, timeout: int = 45, retries: int = 3) -> None:
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update(DEFAULT_HEADERS)
        retry = Retry(
            total=retries,
            connect=retries,
            read=retries,
            backoff_factor=0.6,
            status_forcelist=(429, 500, 502, 503, 504),
            allowed_methods=("GET", "HEAD"),
        )
        adapter = HTTPAdapter(max_retries=retry)
        self.session.mount("http://", adapter)
        self.session.mount("https://", adapter)
        self.registry = build_registry()

    def scrape(self, req: ScrapeRequest) -> ScrapeResult:
        start_url = req.jobs_url.strip()

        parser = self.registry.detect_parser(req.brand, start_url or "", "")[0]
        if not start_url:
            start_url = parser.build_jobs_url(req.location, req.radius)

        if not start_url:
            raise ValueError(f"No jobs URL provided and parser '{parser.brand}' cannot infer one")

        coverage = CoverageReport(brand=req.brand, source_url=start_url)
        all_jobs: list[dict[str, Any]] = []
        seen_urls: set[str] = set()
        pending_urls = [start_url]
        page = 1

        while pending_urls and page <= max(1, req.max_pages):
            current_url = pending_urls.pop(0)
            if current_url in seen_urls:
                continue
            seen_urls.add(current_url)

            html = self._fetch_text(current_url)
            soup = BeautifulSoup(html, "html.parser")
            parser, detection = self.registry.detect_parser(req.brand, current_url, html)
            self._apply_detection(coverage, detection)

            page_jobs = self._extract_jobs_from_page(parser, html, soup, current_url, req, coverage)
            all_jobs.extend(page_jobs)

            next_urls = parser.next_page_urls(current_url, html, page)
            if not next_urls:
                next_urls = self._generic_next_urls(current_url, soup, page)
            pending_urls.extend([u for u in next_urls if u and u not in seen_urls])
            page += 1

        deduped = self._dedupe_and_normalize(all_jobs, req, start_url)
        return ScrapeResult(request=req, jobs=deduped, coverage=coverage)

    def _apply_detection(self, coverage: CoverageReport, detection: ParserDetection) -> None:
        coverage.parser_name = detection.parser_name
        coverage.parser_type = detection.parser_type
        coverage.used_fallback = detection.used_fallback
        coverage.brand_specific_parser_usage = not detection.used_fallback

    def _extract_jobs_from_page(
        self,
        parser: BrandParser,
        html: str,
        soup: BeautifulSoup,
        source_url: str,
        req: ScrapeRequest,
        coverage: CoverageReport,
    ) -> list[dict[str, Any]]:
        jobs: list[dict[str, Any]] = []

        payloads = self._extract_embedded_payloads(html, soup)
        if payloads:
            coverage.embedded_json_hits += len(payloads)

        for payload in payloads:
            try:
                parsed = parser.parse_embedded_data(payload, source_url, req.location)
                if parsed:
                    coverage.embedded_json_success = True
                    jobs.extend(parsed)
            except Exception as exc:
                coverage.warnings.append(f"embedded_parse_error: {exc}")

        try:
            html_jobs = parser.parse_html(html, source_url, req.location)
            jobs.extend(html_jobs)
        except Exception as exc:
            coverage.selector_failures.append(str(exc))

        api_urls = self._discover_api_urls(parser, html, soup, source_url)
        coverage.api_endpoints_probed.extend([u for u in api_urls if u not in coverage.api_endpoints_probed])

        for api_url in api_urls[:8]:
            try:
                payload = self._fetch_json(api_url, source_url)
                api_jobs = parser.parse_api_payload(payload, source_url, req.location)
                jobs.extend(api_jobs)
            except Exception as exc:
                coverage.warnings.append(f"api_probe_failed: {api_url} ({exc})")

        try:
            custom_jobs, custom_warnings = parser.custom_api_jobs(
                self.session,
                source_url,
                html,
                req.location,
                self.timeout,
            )
            if custom_jobs:
                jobs.extend(custom_jobs)
            if custom_warnings:
                coverage.warnings.extend(custom_warnings)
        except Exception as exc:
            coverage.warnings.append(f"custom_api_probe_failed: {exc}")

        return jobs

    def _discover_api_urls(self, parser: BrandParser, html: str, soup: BeautifulSoup, source_url: str) -> list[str]:
        urls = set(parser.discover_api_endpoints(html, source_url))

        for endpoint in self._extract_api_like_strings(html):
            urls.add(endpoint)

        for tag in soup.select("[data-api],[data-endpoint],[data-url]"):
            for attr in ("data-api", "data-endpoint", "data-url"):
                value = tag.get(attr)
                if value:
                    urls.add(value)

        normalized = []
        for url in urls:
            if not url:
                continue
            if url.startswith("//"):
                normalized.append(f"https:{url}")
            elif url.startswith("/"):
                normalized.append(urljoin(source_url, url))
            elif url.startswith("http"):
                normalized.append(url)

        return sorted(set(normalized))

    def _extract_embedded_payloads(self, html: str, soup: BeautifulSoup) -> list[Any]:
        payloads: list[Any] = []

        next_data = soup.find("script", id="__NEXT_DATA__")
        if next_data and next_data.string:
            payloads.extend(self._safe_json_loads_variants(next_data.string))

        for tag in soup.find_all("script", attrs={"type": re.compile(r"application/ld\+json", re.I)}):
            payloads.extend(self._safe_json_loads_variants(tag.get_text() or ""))

        script_text = "\n".join((tag.get_text() or "") for tag in soup.find_all("script"))

        for marker in ["window.__PRELOAD_STATE__", "window.PRELOAD_STATE"]:
            snippet = self._extract_assignment_json(script_text, marker)
            if snippet:
                payloads.extend(self._safe_json_loads_variants(snippet))

        for _, blob in re.findall(
            r'window\.([A-Za-z0-9_]*(?:STATE|DATA))\s*=\s*(\{.*?\})\s*;',
            html,
            flags=re.DOTALL,
        ):
            payloads.extend(self._safe_json_loads_variants(blob))

        return payloads

    def _extract_assignment_json(self, text: str, marker: str) -> str:
        idx = text.find(marker)
        if idx < 0:
            return ""
        eq = text.find("=", idx)
        if eq < 0:
            return ""
        return self._balanced_json_extract(text[eq + 1 :])

    def _safe_json_loads_variants(self, text: str) -> list[Any]:
        raw = (text or "").strip()
        out: list[Any] = []
        if not raw:
            return out

        candidates = [raw, raw.rstrip(";"), raw.replace("\\x3c", "<")]
        for candidate in candidates:
            try:
                out.append(json.loads(candidate))
            except json.JSONDecodeError:
                extracted = self._balanced_json_extract(candidate)
                if extracted:
                    try:
                        out.append(json.loads(extracted))
                    except json.JSONDecodeError:
                        continue
        return out

    def _balanced_json_extract(self, text: str) -> str:
        start_obj = text.find("{")
        start_arr = text.find("[")
        starts = [x for x in (start_obj, start_arr) if x >= 0]
        if not starts:
            return ""

        start = min(starts)
        opening = text[start]
        closing = "}" if opening == "{" else "]"

        depth = 0
        in_string = False
        escape = False
        for idx in range(start, len(text)):
            ch = text[idx]
            if in_string:
                if escape:
                    escape = False
                elif ch == "\\":
                    escape = True
                elif ch == '"':
                    in_string = False
                continue

            if ch == '"':
                in_string = True
            elif ch == opening:
                depth += 1
            elif ch == closing:
                depth -= 1
                if depth == 0:
                    return text[start : idx + 1]
        return ""

    def _extract_api_like_strings(self, html: str) -> list[str]:
        results = []
        pattern = re.compile(r'("|\')((?:/|https?://)[^"\']*(?:api|graphql|jobs|requisitions)[^"\']*)("|\')', re.IGNORECASE)
        for _, value, _ in pattern.findall(html):
            results.append(value)
        return results

    def _generic_next_urls(self, current_url: str, soup: BeautifulSoup, page: int) -> list[str]:
        found: set[str] = set()

        for tag in soup.select('a[rel="next"], link[rel="next"]'):
            href = tag.get("href")
            if href:
                found.add(urljoin(current_url, href))

        for tag in soup.find_all("a"):
            text = (tag.get_text() or "").strip().lower()
            if text in {"next", "more", "next page", ">", "»"}:
                href = tag.get("href")
                if href:
                    found.add(urljoin(current_url, href))

        if not found:
            params = {"page": page + 1}
            separator = "&" if "?" in current_url else "?"
            found.add(f"{current_url}{separator}{urlencode(params)}")

        return sorted(found)

    def _fetch_text(self, url: str) -> str:
        response = self.session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.text

    def _fetch_json(self, url: str, source_url: str) -> Any:
        headers = {"Referer": source_url, "Accept": "application/json,text/plain,*/*"}
        response = self.session.get(url, timeout=self.timeout, headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "json" not in content_type.lower() and not response.text.strip().startswith(("{", "[")):
            raise ValueError("non-json API response")
        return response.json()

    def _dedupe_and_normalize(
        self, jobs: list[dict[str, Any]], req: ScrapeRequest, default_source_url: str
    ) -> list[dict[str, Any]]:
        normalized = [self._normalize_job(job, req, default_source_url) for job in jobs]
        deduped: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()

        for item in normalized:
            key = (item["source"], item["source_id"])
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    def _normalize_job(self, job: dict[str, Any], req: ScrapeRequest, default_source_url: str) -> dict[str, Any]:
        title = self._pick_text(job, ["title", "jobTitle", "position", "positionTitle", "name"], "Untitled role")
        description = self._pick_text(
            job,
            ["description", "jobDescription", "shortDescription", "snippet", "summary"],
            f"{title} role",
        )
        location = self._pick_text(job, ["location", "jobLocation", "city", "locationText"], req.location)
        source_url = self._pick_text(job, ["source_url", "sourceUrl", "url", "jobUrl", "applyURL"], default_source_url)

        raw_skills = job.get("skills") if isinstance(job.get("skills"), list) else []
        inferred_skills = self._infer_skills(f"{title} {description}")
        skills = self._dedupe_skills([*raw_skills, *inferred_skills])[:24]

        direct_min = self._pick_number(
            job,
            ["hourly_rate_min", "hourlyRateMin", "compensation_from", "hourlyMin", "minHourlyRate"],
        )
        direct_max = self._pick_number(
            job,
            ["hourly_rate_max", "hourlyRateMax", "compensation_to", "hourlyMax", "maxHourlyRate"],
        )

        pay_blob = " ".join(
            [
                title,
                description,
                self._pick_text(job, ["salary", "compensation", "pay", "hourlyRate"], ""),
            ]
        )
        hourly_min, hourly_max, currency = self._parse_hourly(pay_blob)
        if direct_min is not None:
            hourly_min = direct_min
        if direct_max is not None:
            hourly_max = direct_max
        elif direct_min is not None and hourly_max is None:
            hourly_max = direct_min

        job_type = self._infer_job_type(f"{title} {description} {self._pick_text(job, ['employmentType', 'type'], '')}")
        category = self._infer_category(skills, f"{title} {description}")

        source_id = self._pick_text(
            job,
            ["source_id", "sourceId", "id", "jobId", "job_id", "reference", "requisitionId", "uniqueID"],
            "",
        )
        if not source_id:
            stable_blob = f"{req.brand}|{title}|{location}|{source_url}"
            source_id = hashlib.sha256(stable_blob.encode("utf-8")).hexdigest()[:24]

        posted_at = self._parse_posted_at(
            self._pick_text(job, ["posted_at", "postedAt", "datePosted", "createdAt", "updatedAt"], "")
        )

        return {
            "title": title,
            "description": description,
            "skills": skills,
            "category": category,
            "type": "remote" if "remote" in description.lower() else "local",
            "job_type": job_type,
            "budget": None,
            "hourly_rate_min": hourly_min,
            "hourly_rate_max": hourly_max,
            "currency": currency,
            "location": location or req.location,
            "source": req.brand.lower(),
            "source_id": source_id,
            "source_url": source_url,
            "client_verified": True,
            "posted_at": posted_at,
        }

    def _parse_posted_at(self, value: str) -> str:
        raw = (value or "").strip()
        if not raw:
            return datetime.now(timezone.utc).isoformat()

        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
        except ValueError:
            return datetime.now(timezone.utc).isoformat()

    def _pick_text(self, obj: dict[str, Any], keys: list[str], fallback: str = "") -> str:
        for key in keys:
            value = obj.get(key)
            if value is None:
                continue
            if isinstance(value, str):
                cleaned = re.sub(r"\s+", " ", value).strip()
                if cleaned:
                    return cleaned
            elif isinstance(value, (int, float)):
                return str(value)
        return fallback

    def _pick_number(self, obj: dict[str, Any], keys: list[str]) -> float | None:
        for key in keys:
            value = obj.get(key)
            if value is None:
                continue
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str):
                match = re.search(r"-?\d+(?:\.\d+)?", value.replace(",", ""))
                if match:
                    return float(match.group(0))
        return None

    def _dedupe_skills(self, values: list[str]) -> list[str]:
        out: list[str] = []
        seen: set[str] = set()
        for value in values:
            skill = re.sub(r"\s+", " ", str(value or "")).strip()
            key = skill.lower()
            if not skill or key in seen:
                continue
            seen.add(key)
            out.append(skill)
        return out

    def _infer_skills(self, text: str) -> list[str]:
        haystack = text.lower()
        mapping = {
            "customer service": ["customer", "guest", "hospitality", "cashier"],
            "food safety": ["food safety", "sanitation", "haccp"],
            "teamwork": ["team", "collaborate", "crew"],
            "leadership": ["lead", "manager", "supervisor"],
            "cooking": ["cook", "kitchen", "prep"],
            "delivery": ["driver", "delivery"],
            "barista": ["barista", "espresso", "coffee"],
            "point of sale": ["pos", "register", "cash handling"],
        }
        found = []
        for skill, needles in mapping.items():
            if any(n in haystack for n in needles):
                found.append(skill)
        return found

    def _infer_category(self, skills: list[str], text: str) -> str:
        lower_skills = {s.lower() for s in skills}
        blob = text.lower()
        if "leadership" in lower_skills or "manager" in blob:
            return "management"
        if "delivery" in lower_skills or "driver" in blob:
            return "delivery"
        if "barista" in lower_skills or "coffee" in blob:
            return "barista"
        if "cooking" in lower_skills or "kitchen" in blob:
            return "kitchen"
        return "restaurant"

    def _infer_job_type(self, text: str) -> str:
        blob = text.lower()
        if "part-time" in blob or "part time" in blob:
            return "part-time"
        if "full-time" in blob or "full time" in blob:
            return "full-time"
        if "contract" in blob or "seasonal" in blob:
            return "contract"
        return "unspecified"

    def _parse_hourly(self, text: str) -> tuple[float | None, float | None, str]:
        blob = text or ""
        currency = "USD"
        if any(c in blob for c in ["€", "EUR"]):
            currency = "EUR"
        elif any(c in blob for c in ["£", "GBP"]):
            currency = "GBP"

        range_match = re.search(r'\$?\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:/hr|per\s*hour|hourly|/hour)', blob, flags=re.IGNORECASE)
        if range_match:
            return float(range_match.group(1)), float(range_match.group(2)), currency

        single_match = re.search(r'\$\s*(\d+(?:\.\d+)?)\s*(?:/hr|per\s*hour|hourly|/hour)', blob, flags=re.IGNORECASE)
        if single_match:
            value = float(single_match.group(1))
            return value, value, currency

        up_to = re.search(r'up\s*to\s*\$\s*(\d+(?:\.\d+)?)', blob, flags=re.IGNORECASE)
        if up_to:
            return None, float(up_to.group(1)), currency

        return None, None, currency
