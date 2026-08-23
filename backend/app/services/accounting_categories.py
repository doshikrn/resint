from __future__ import annotations

import re


UNCATEGORIZED = "Uncategorized"

DESSERTS = "Десерты, сладости товары"
FROZEN = "Заморозка товары"
CANNED = "Консервы товары"
DAIRY = "Молочные товары"
GROCERY = "Бакалея товары"
MEAT = "Мясо, курица товар"
PRODUCE = "Овощи, зелень, фрукты товары"
SEAFOOD = "Рыба, морепродукты товар"
SPICES_AND_SAUCES = "Специи, соуса товары"
CHEESE_AND_DELI = "Сыры, колбасы, копчености товар"
BAKERY = "Хлебобулочные товары"


# Stable product codes transcribed from the approved accounting report. This map is
# intentionally scoped to export fallback; an explicit catalog category always wins.
_REFERENCE_CODES_BY_CATEGORY: dict[str, frozenset[str]] = {
    DESSERTS: frozenset(
        {
            "01564",
            "02650",
            "01382",
            "00257",
            "01455",
            "02581",
            "01566",
            "02631",
        }
    ),
    FROZEN: frozenset(
        {
            "01313",
            "01316",
            "00251",
            "00252",
            "01932",
            "01831",
            "02057",
            "01567",
            "01312",
            "00253",
        }
    ),
    CANNED: frozenset(
        {
            "01693",
            "01086",
            "01164",
            "01692",
            "01598",
            "01085",
            "01116",
            "01082",
            "01081",
            "01754",
            "01380",
            "01679",
            "01083",
            "01265",
            "01087",
        }
    ),
    DAIRY: frozenset(
        {
            "01280",
            "01499",
            "01145",
            "01144",
            "01127",
            "01208",
            "01511",
            "00254",
            "01287",
            "01506",
            "01072",
            "01071",
            "01500",
        }
    ),
    GROCERY: frozenset(
        {
            "01062",
            "01593",
            "01241",
            "01640",
            "01592",
            "01153",
            "02438",
            "01230",
            "00249",
            "01467",
            "01529",
            "01803",
            "01751",
            "01607",
            "01061",
            "00261",
            "01897",
            "01346",
            "01121",
            "02610",
            "01063",
            "01064",
            "01089",
            "01078",
            "00262",
            "01184",
            "01108",
            "01169",
            "02493",
            "01200",
            "01201",
            "01285",
            "01604",
            "01321",
            "01038",
            "01625",
            "01530",
            "01535",
            "02473",
            "01088",
            "02428",
            "01182",
            "01919",
            "01528",
            "01247",
        }
    ),
    MEAT: frozenset(
        {
            "01097",
            "02674",
            "02673",
            "02682",
            "00255",
            "01092",
            "01091",
            "02115",
            "01728",
            "01093",
            "01094",
            "01464",
        }
    ),
    PRODUCE: frozenset(
        {
            "02538",
            "01497",
            "01502",
            "02456",
            "01255",
            "02660",
            "01140",
            "01104",
            "01512",
            "02686",
            "01245",
            "01253",
            "02058",
            "01229",
            "01256",
            "01699",
            "01206",
            "02170",
            "01220",
            "01902",
            "02661",
            "01118",
            "01105",
            "01516",
            "01602",
            "02687",
            "01243",
            "00250",
            "02609",
        }
    ),
    SEAFOOD: frozenset(
        {
            "01309",
            "01266",
            "01207",
            "02027",
            "02392",
            "01074",
            "02632",
            "01894",
            "01824",
            "01075",
            "01544",
            "01882",
            "01933",
            "02613",
            "01344",
            "01277",
            "01262",
        }
    ),
    SPICES_AND_SAUCES: frozenset(
        {
            "01608",
            "01186",
            "01800",
            "01603",
            "01359",
            "01678",
            "01924",
            "01856",
            "01202",
            "01236",
            "01233",
            "01261",
            "01623",
            "01068",
            "01691",
            "01069",
            "01181",
            "01688",
            "01197",
            "01584",
            "01190",
            "01705",
        }
    ),
    CHEESE_AND_DELI: frozenset(
        {
            "01425",
            "01503",
            "01422",
            "01504",
            "01146",
            "01303",
            "01302",
            "01520",
            "01428",
            "01347",
            "02700",
            "01079",
            "01586",
            "01160",
            "01348",
            "01173",
            "00259",
            "01305",
            "01080",
        }
    ),
    BAKERY: frozenset(
        {
            "01276",
            "01481",
            "01737",
            "01150",
            "02683",
            "01582",
            "00260",
            "01151",
            "01732",
            "01753",
        }
    ),
}

_REFERENCE_CATEGORY_BY_CODE = {
    code: category
    for category, codes in _REFERENCE_CODES_BY_CATEGORY.items()
    for code in codes
}


# A trailing * means a token prefix; phrases are matched after punctuation and
# whitespace normalization. Stronger/specific groups come before broad pantry rules.
_NAME_RULES: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        SEAFOOD,
        (
            "рыб*",
            "лосос*",
            "семг*",
            "форел*",
            "тунец*",
            "кревет*",
            "кальмар*",
            "осьминог*",
            "устриц*",
            "сибас*",
            "судак*",
            "угор*",
            "морепродукт*",
            "морской коктейль",
            "морской язык",
            "крабов*",
            "анчоус*",
        ),
    ),
    (
        BAKERY,
        (
            "хлеб*",
            "булоч*",
            "лаваш*",
            "круассан*",
            "пампуш*",
            "сухар*",
            "тост*",
            "лепеш*",
            "пирог*",
        ),
    ),
    (
        DESSERTS,
        (
            "десерт*",
            "торт*",
            "пирожн*",
            "печень*",
            "маффин*",
            "кекс*",
            "конфет*",
            "шоколад*",
            "синабон*",
            "чак чак",
            "варенье",
            "крамбл*",
        ),
    ),
    (
        FROZEN,
        (
            "заморож*",
            "замороз*",
            "картофель фри",
            "наггет*",
            "сырные палочки",
        ),
    ),
    (
        CANNED,
        (
            "консерв*",
            "маринован*",
            "солен*",
            "корнишон*",
            "оливк*",
            "маслин*",
            "пилати",
            "томатная паста",
        ),
    ),
    (
        MEAT,
        (
            "говядин*",
            "баран*",
            "конин*",
            "курин*",
            "куриц*",
            "индей*",
            "мяс*",
            "теля*",
            "свинин*",
            "утк*",
            "ягнен*",
            "кролик*",
            "котлет*",
            "грудин*",
            "крыл*",
            "окороч*",
            "куырдак*",
            "паштет*",
        ),
    ),
    (
        SPICES_AND_SAUCES,
        (
            "соус*",
            "майонез*",
            "кетчуп*",
            "горчиц*",
            "уксус*",
            "спец*",
            "приправа",
            "кориандр*",
            "куркум*",
            "зир*",
            "паприк*",
            "лавров*",
            "перец молотый",
            "демиглас*",
            "аджик*",
            "лазджан*",
            "васаби",
            "хондаши",
            "зеленое масло",
        ),
    ),
    (
        PRODUCE,
        (
            "овощ*",
            "зелень",
            "картоф*",
            "капуст*",
            "морков*",
            "лук*",
            "чеснок*",
            "томат*",
            "помидор*",
            "огур*",
            "перец*",
            "гриб*",
            "броккол*",
            "баклаж*",
            "кабач*",
            "тыкв*",
            "свекл*",
            "салат*",
            "шпинат*",
            "абрикос*",
            "авокадо",
            "ананас*",
            "апельсин*",
            "арбуз*",
            "банан*",
            "виноград*",
            "гранат*",
            "грейпфрут*",
            "груш*",
            "дын*",
            "клубник*",
            "пюре",
            "пассиров*",
        ),
    ),
    (
        CHEESE_AND_DELI,
        (
            "сыр*",
            "брынз*",
            "сулугун*",
            "моцарел*",
            "колбас*",
            "сосиск*",
            "сардель*",
            "бастурм*",
            "бекон*",
            "ветчин*",
            "копчен*",
            "сервелат*",
            "салями",
            "камамбер",
            "пармезан*",
            "гауда",
            "маасдам",
            "дор блю",
            "креметт*",
            "казы",
            "жая",
        ),
    ),
    (
        DAIRY,
        (
            "молок*",
            "сливк*",
            "сметан*",
            "кефир*",
            "йогурт*",
            "творог*",
            "сгущен*",
            "морожен*",
            "масло сливочное",
        ),
    ),
    (
        GROCERY,
        (
            "рис",
            "круп*",
            "макарон*",
            "лапш*",
            "мук*",
            "сахар*",
            "соль",
            "крахмал*",
            "масло растительное",
            "масло оливковое",
            "масло кунжутное",
            "нут",
            "чечевиц*",
            "булгур",
            "греч*",
            "киноа",
            "кускус",
            "манн*",
            "перлов*",
            "пшено",
            "фунчоз*",
            "хумус",
            "тахин*",
            "мисо паста",
            "дрожж*",
            "желатин",
            "заварка",
            "лагман*",
            "тесто",
        ),
    ),
)


def _normalize_product_code(value: object) -> str:
    code = str(value or "").strip()
    if code.isdigit() and len(code) < 5:
        return code.zfill(5)
    return code


def _normalize_name(value: object) -> str:
    normalized = str(value or "").casefold().replace("ё", "е")
    return re.sub(r"[^0-9a-zа-я]+", " ", normalized).strip()


def _matches_any(normalized_name: str, terms: tuple[str, ...]) -> bool:
    if not normalized_name:
        return False
    tokens = normalized_name.split()
    padded_name = f" {normalized_name} "
    for raw_term in terms:
        term = raw_term.casefold().replace("ё", "е")
        if term.endswith("*"):
            prefix = term[:-1]
            if any(token.startswith(prefix) for token in tokens):
                return True
        elif " " in term:
            if f" {term} " in padded_name:
                return True
        elif term in tokens:
            return True
    return False


def resolve_accounting_category(
    category: object,
    *,
    product_code: object,
    item_name: object,
) -> str:
    """Return the export group without overriding an explicit catalog category."""

    explicit_category = str(category or "").strip()
    if explicit_category and explicit_category.casefold() != UNCATEGORIZED.casefold():
        return explicit_category

    reference_category = _REFERENCE_CATEGORY_BY_CODE.get(
        _normalize_product_code(product_code)
    )
    if reference_category:
        return reference_category

    normalized_name = _normalize_name(item_name)
    for inferred_category, terms in _NAME_RULES:
        if _matches_any(normalized_name, terms):
            return inferred_category

    return UNCATEGORIZED
