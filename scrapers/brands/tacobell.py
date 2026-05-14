from __future__ import annotations

from .common import GenericRestaurantParser


class TacoBellParser(GenericRestaurantParser):
    brand = "taco_bell"
    aliases = ("tacobell", "yum")
    domains = ("jobs.tacobell.com", "tacobell.wd1.myworkdayjobs.com")
    search_url_template = "https://jobs.tacobell.com/"
