"""Recursos del idioma inglés (normalizados: minúsculas y sin tildes)."""

STOPWORDS = frozenset("""
a about above after again all am an and any are as at be because been before being
below between both but by can could did do does doing down during each few for from
further had has have having he her here hers him his how i if in into is it its just
me more most my no nor not now of off on once only or other our ours out over own same
she should so some such than that the their them then there these they this those
through to too under until up very was we were what when where which while who whom
why will with would you your yours
""".split())

ABBREVIATIONS = {
    "u": "you", "ur": "your", "r": "are", "pls": "please", "plz": "please",
    "thx": "thanks", "thanx": "thanks", "ty": "thank you", "tnx": "thanks",
    "im": "i am", "dont": "do not", "cant": "can not", "wont": "will not",
    "isnt": "is not", "didnt": "did not", "doesnt": "does not", "ive": "i have",
    "idk": "i do not know", "btw": "by the way", "asap": "as soon as possible",
    "b4": "before", "gonna": "going to", "wanna": "want to", "gotta": "got to",
    "yep": "yes", "yup": "yes", "yeah": "yes", "ya": "yes", "nope": "no", "nah": "no",
    "ok": "ok", "okay": "ok", "k": "ok", "info": "information", "tmr": "tomorrow",
    "tmrw": "tomorrow", "2day": "today", "2morrow": "tomorrow",
}

NUM_SMALL = {
    "zero": 0, "a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
NUM_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}
NUM_HUNDREDS = {}
NUM_HUNDRED_WORD = "hundred"
NUM_THOUSAND = {"thousand": 1000}
NUM_MILLION = {"million": 10**6, "millions": 10**6, "billion": 10**9}
NUM_JOIN = "and"
NUM_WEAK = frozenset({"a", "an"})

ORDINALS = {
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
    "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
}
ORDINALS_WEAK = frozenset({"second", "fourth"})
ORDINAL_SUFFIXES = frozenset({"st", "nd", "rd", "th"})

MONTHS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
    "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12,
}
WEEKDAYS = {
    "monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4,
    "saturday": 5, "sunday": 6, "mon": 0, "tue": 1, "tues": 1, "thu": 3, "thurs": 3,
    "fri": 4,
}
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July",
               "August", "September", "October", "November", "December"]
WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
                 "Sunday"]

DURATION_UNITS = {
    "second": "s", "seconds": "s", "sec": "s", "secs": "s",
    "minute": "min", "minutes": "min", "min": "min", "mins": "min",
    "hour": "h", "hours": "h", "h": "h", "hr": "h", "hrs": "h",
    "day": "day", "days": "day", "week": "wk", "weeks": "wk",
    "month": "mo", "months": "mo", "year": "yr", "years": "yr",
}

CURRENCY_WORDS = {
    "euro": "EUR", "euros": "EUR", "eur": "EUR", "€": "EUR",
    "dollar": "USD", "dollars": "USD", "usd": "USD", "$": "USD", "bucks": "USD",
    "pound": "GBP", "pounds": "GBP", "£": "GBP", "gbp": "GBP",
}
PERCENT_WORDS = ("percent", "per cent", "%")

CANCEL_WORDS = frozenset({"cancel", "stop", "quit", "exit", "nevermind", "forget",
                          "nothing", "none"})
CANCEL_FILLER = frozenset({"it", "please", "just", "no", "never", "mind", "that",
                           "ok", "i", "want", "to", "about"})
LEADING_FILLERS = frozenset({"hey", "hi", "hello", "so", "well", "ok", "okay", "um", "uh"})

TEXTS = {
    "cancelled": "Okay, let's leave it there.",
    "fallback": "Sorry, I didn't get that. Can you say it another way?",
    "list_and": "and",
}
