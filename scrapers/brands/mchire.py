from __future__ import annotations

from urllib.parse import quote_plus

from .common import GenericRestaurantParser


class McHireParser(GenericRestaurantParser):
    brand = "mchire"
    aliases = ("mcdonalds", "mcdonald", "mcd")
    domains = ("jobs.mchire.com",)

    def build_jobs_url(self, location: str, radius: int | None = None) -> str:
        del radius
        target = quote_plus((location or "Austin, TX").strip())
        return f"https://jobs.mchire.com/jobs?location_type=2&location_name={target}"
