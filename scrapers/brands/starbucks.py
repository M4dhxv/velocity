from __future__ import annotations

from .common import GenericRestaurantParser


class StarbucksParser(GenericRestaurantParser):
    brand = "starbucks"
    aliases = ("sbux",)
    domains = ("careers.starbucks.com", "starbucks.taleo.net")
    search_url_template = "https://careers.starbucks.com/"
