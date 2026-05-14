from __future__ import annotations

from .common import GenericRestaurantParser


class WendysParser(GenericRestaurantParser):
    brand = "wendys"
    aliases = ("wendy's",)
    domains = ("wendys-careers.com", "careers.wendys.com")
    search_url_template = "https://wendys-careers.com/"
