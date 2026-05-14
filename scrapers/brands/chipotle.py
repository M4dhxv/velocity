from __future__ import annotations

from .common import GenericRestaurantParser


class ChipotleParser(GenericRestaurantParser):
    brand = "chipotle"
    aliases = ("cmg",)
    domains = ("jobs.chipotle.com", "careers.chipotle.com")
    search_url_template = "https://jobs.chipotle.com/"
