from __future__ import annotations

from .common import GenericRestaurantParser


class BurgerKingParser(GenericRestaurantParser):
    brand = "burger_king"
    aliases = ("burgerking", "bk")
    domains = ("careers.bk.com", "careers.burgerking.com")
    search_url_template = "https://careers.bk.com/"
