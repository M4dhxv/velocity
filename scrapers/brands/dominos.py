from __future__ import annotations

from .common import GenericRestaurantParser


class DominosParser(GenericRestaurantParser):
    brand = "dominos"
    aliases = ("domino's",)
    domains = ("jobs.dominos.com", "careers.dominos.com")
    search_url_template = "https://jobs.dominos.com/us/jobs/"
