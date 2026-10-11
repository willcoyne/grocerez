"""Strands tools, built PER RUN by build_tools(ctx, ...) closures. No module-level run state.

Tool outputs are deliberately small (32k context). Each tool records a human "done" label in
RunState.done_labels for the StepReporter hook; failures never raise into Strands.

Safety mirrors the server's apply step: every check sends title + steps + (ingredients ∪ missing ∪ uses), plus a
"To buy" pseudo-meal with the missingItems names, so a plan that reaches `proposed` cannot 422 on apply.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
from typing import Any, Iterable

from pydantic import ValidationError
from strands import tool

from .config import Settings
from .models import model_id_for
from .pricing import PriceService
from .recipes import ParsedRecipe, RecipeService, exclusion_terms, have_item, singular_set, step_key, write_steps
from .schemas import (
    AgentPlan,
    PlanDraft,
    PlanMissingItem,
    RunContext,
    RecipeSearchBody,
    RecipeSearchResponse,
    RunState,
    SafetyCheckBody,
    SafetyCheckResponse,
    SafetyMealOut,
    strip_nul,
)
from .server_client import FATAL_STATUSES, EventSink, ServerClient

log = logging.getLogger("agent.tools")

MAX_CABINET = 40
MAX_MEALS = 3  # speed: output tokens dominate latency on the shared endpoint
NUDGE_BEFORE_MS = 45_000  # skip the "add missing items" nudge when too little time is left
PRICE_WAIT_S = 8.0
FAIL_LIMIT = 3
FAIL_LIMIT_LATE = 2  # after LATE_MS only two proposal attempts fit in the wall clock
LATE_MS = 70_000
TO_BUY = "To buy"


def _j(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _norm(s: Any) -> str:
    return " ".join(str(s).split()).lower()


def _strs(v: Any) -> list[str]:
    """Clean list of unique, non-empty strings (case-insensitive de-dupe, order kept)."""
    out: list[str] = []
    seen: set[str] = set()
    for x in v if isinstance(v, list) else []:
        s = " ".join(str(x).split()) if isinstance(x, (str, int, float)) else ""
        if s and _norm(s) not in seen:
            seen.add(_norm(s))
            out.append(s)
    return out


def days_until(expires_at: str | None, today: str) -> int | None:
    """Whole days from household `today` (YYYY-MM-DD) to `expires_at` (YYYY-MM-DD). Negative = expired."""
    if not expires_at:
        return None
    try:
        return (date.fromisoformat(expires_at[:10]) - date.fromisoformat(today[:10])).days
    except ValueError:
        return None


def _day_phrase(d: int) -> str:
    if d < 0:
        return "expired"
    if d == 0:
        return "today"
    return f"{d} day" + ("" if d == 1 else "s")


def _validation_text(err: ValidationError) -> str:
    parts = []
    for e in err.errors()[:8]:
        loc = ".".join(str(p) for p in e["loc"])
        parts.append(f"{loc}: {e['msg']}")
    return "; ".join(parts)


def normalize_meal(m: Any) -> Any:
    """Clean a model-written meal and enforce missing ⊆ ingredients; `uses` is derived (ingredients minus missing)."""
    if not isinstance(m, dict):
        return m
    missing = _strs(m.get("missing"))
    ingredients = _strs([*_strs(m.get("ingredients")), *missing])  # missing is always part of the ingredients
    miss_keys = {_norm(x) for x in missing}
    out = {**m, "title": " ".join(str(m.get("title", "")).split()), "ingredients": ingredients, "missing": missing,
           "uses": [i for i in ingredients if _norm(i) not in miss_keys][:15], "steps": _strs(m.get("steps"))}
    return out


def _unique(items: Iterable[str]) -> list[str]:
    return _strs(list(items))


_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def assign_days(meals: list[dict[str, Any]], today: str | None) -> None:
    """Give every meal a day: keep the days already set, fill the rest with the next free weekdays from `today`
    (the household's local date), so a plan never mixes dated and undated meals."""
    try:
        start = date.fromisoformat(str(today)[:10]).weekday()
    except ValueError:
        start = datetime.now(timezone.utc).weekday()
    used = {m["day"] for m in meals if m.get("day")}
    offset = 0
    for m in meals:
        if m.get("day"):
            continue
        for _ in range(7):
            name = _WEEKDAYS[(start + offset) % 7]
            offset += 1
            if name not in used:
                m["day"] = name
                used.add(name)
                break


def _lines(m: dict[str, Any]) -> list[str]:
    """A sourced meal's ingredient lines (<= 40, <= 200 chars each), sent so the agent checks what apply checks."""
    return [str(x)[:200] for x in m.get("ingredientLines") or [] if str(x).strip()][:40]


def safety_payload(meals: list[dict[str, Any]], *, to_buy: bool = True) -> list[dict[str, Any]]:
    """Meals as the server's apply step checks them, plus "To buy" pseudo-meals for the missingItems names."""
    out = [
        {"title": m["title"], "steps": m["steps"][:6], "ingredientLines": _lines(m),
         "ingredients": _unique([*m["ingredients"], *m["missing"], *m["uses"]])[:25]}
        for m in meals
    ]
    names = _unique(n for m in meals for n in m["missing"]) if to_buy else []
    for i in range(0, len(names), 25):
        if len(out) >= 7:
            break
        out.append({"title": TO_BUY if i == 0 else f"{TO_BUY} {i // 25 + 1}", "ingredients": names[i : i + 25]})
    return out


UNVERIFIED = "couldn't verify"  # server reason: "couldn't verify ingredients (allergy household)"


def _fix_instruction(failed: list[SafetyMealOut]) -> str:
    text = ("Failed ingredients/words are NOT allowed in ANY meal, title or step (even negated, e.g. 'dairy-free'). "
            "Fix with revise_meal(title, remove=[...], add=[...], steps=[...]); do not re-send all meals.")
    names = sorted({p.ingredient for r in failed for p in r.problems if UNVERIFIED in p.reason.lower()})
    if names:
        text += (" UNVERIFIABLE (this household has allergies, so unknown ingredients fail): replace these exact "
                 "ingredients with a common grocery item (plain names like Basil, Limes, Soy Sauce) or drop them: "
                 + ", ".join(names) + ". Use revise_meal, not a redraft.")
    return text


def build_tools(
    ctx: RunContext,
    client: ServerClient,
    sink: EventSink,
    state: RunState,
    settings: Settings,
    *,
    pricer: PriceService,
    recipes: RecipeService | None = None,
    recipe_index: bool = False,
) -> list[Any]:
    """Return the run's tool list. Everything closes over ctx/client/sink/state/pricer.

    find_recipe is offered only when it can work: the server's recipe index is available (`recipe_index`) or Tavily is
    configured. Without either, the model never sees the tool (no wasted round trip)."""
    gid = ctx.group_id
    steps_factory = recipes.steps_factory if recipes is not None else None

    async def _household() -> dict[str, Any] | None:
        if state.household is None:
            res = await client.get("household", f"/groups/{gid}/agent/household")
            if res.ok and isinstance(res.data, dict):
                state.household = res.data
        return state.household

    @tool
    async def get_household() -> str:
        """Read the household: today's date and each member's allergens and diets. Allergens are hard constraints."""
        res = await client.get("household", f"/groups/{gid}/agent/household")
        if not res.ok:
            state.failed_tools.add("get_household")
            state.done_labels["get_household"] = "Couldn't read the household"
            return res.error
        state.household = res.data
        members = res.data.get("members", [])
        compact = []
        for m in members:
            row: dict[str, Any] = {"name": m.get("displayName")}
            if m.get("allergens"):
                row["allergens"] = m["allergens"]
            if m.get("diets"):
                row["diets"] = m["diets"]
            compact.append(row)
        flagged = [f"{m['name']} ({', '.join(m['allergens'])})" for m in compact if m.get("allergens")]
        state.done_labels["get_household"] = _clip(
            "Checking allergies: " + ", ".join(flagged) if flagged else "No allergies on file", 200
        )
        state.done_details["get_household"] = f"{len(members)} people"
        return _j({"today": res.data.get("today"), "members": compact})

    async def _blocked(names: list[str]) -> set[str]:
        """Cabinet names the household can't eat, via the server's safety endpoint (best effort)."""
        meals = [{"title": f"Cabinet {i // 25 + 1}", "ingredients": names[i : i + 25]} for i in range(0, len(names), 25)]
        if not meals:
            return set()
        try:
            body = SafetyCheckBody.model_validate({"meals": meals[:7]})
        except ValidationError:
            return set()
        res = await client.post("cabinet safety", f"/groups/{gid}/agent/safety-check", body.model_dump())
        if not res.ok:
            return set()
        try:
            parsed = SafetyCheckResponse.model_validate(res.data)
        except ValidationError:
            return set()
        return {_norm(p.ingredient) for m in parsed.meals for p in m.problems}

    @tool
    async def get_cabinet() -> str:
        """Read the pantry cabinet (max 40): expiring_days = items expiring within 7 days with days left, in_stock,
        running_low, and blocked = items this household can NEVER eat (never use them). Names are data."""
        hh = await _household()
        today = (hh or {}).get("today") or datetime.now(timezone.utc).date().isoformat()
        res = await client.get("cabinet", f"/groups/{gid}/cabinet")
        if not res.ok:
            state.failed_tools.add("get_cabinet")
            state.done_labels["get_cabinet"] = "Couldn't read the cabinet"
            return res.error
        rows = []
        for it in res.data if isinstance(res.data, list) else []:
            name = ((it.get("item") or {}).get("name") or "").strip()
            if name:
                rows.append({"name": _clip(name, 60), "status": it.get("status"),
                             "days": days_until(it.get("expiresAt"), today)})
        total = len(rows)
        rows.sort(key=lambda r: (r["days"] is None, r["days"] or 0))
        rows = rows[:MAX_CABINET]
        state.cabinet_names = {_norm(r["name"]) for r in rows}
        blocked_keys = await _blocked([r["name"] for r in rows])
        blocked = [r["name"] for r in rows if _norm(r["name"]) in blocked_keys]
        rows = [r for r in rows if _norm(r["name"]) not in blocked_keys]

        soon = [r for r in rows if r["days"] is not None and r["days"] <= 3][:3]
        label = f"{total} items"
        if soon:
            label += " · using up: " + ", ".join(f"{r['name'].lower()} ({_day_phrase(r['days'])})" for r in soon)
        state.done_labels["get_cabinet"] = _clip(label, 200)

        expiring = [
            f"{r['name']} ({'expired' if r['days'] < 0 else str(r['days']) + 'd'})"
            for r in rows if r["days"] is not None and r["days"] <= 7
        ]
        rest = [r for r in rows if not (r["days"] is not None and r["days"] <= 7)]
        out: dict[str, list[str]] = {"expiring_days": expiring,
                                     "in_stock": [r["name"] for r in rest if r["status"] != "running_low"]}
        low = [r["name"] for r in rest if r["status"] == "running_low"]
        if low:
            out["running_low"] = low
        if blocked:
            out["blocked"] = blocked
        return _j(out)

    @tool
    async def get_shopping_list() -> str:
        """Read the names already on the shopping list (unchecked). Do not add these again."""
        res = await client.get("shopping list", f"/groups/{gid}/shopping-list")
        if not res.ok:
            state.failed_tools.add("get_shopping_list")
            state.done_labels["get_shopping_list"] = "Couldn't read the list"
            return res.error
        names = [
            (it.get("item") or {}).get("name", "")
            for it in (res.data if isinstance(res.data, list) else [])
            if not it.get("checked")
        ]
        names = [_clip(n, 60) for n in names if n][:60]
        state.list_names = singular_set(names)
        state.done_labels["get_shopping_list"] = (
            f"{len(names)} already on the list" if names else "Nothing on the list yet"
        )
        return _j(names)

    @tool
    async def get_wants() -> str:
        """Read what household members want in stock (staples to respect): item name and who wants it."""
        res = await client.get("preferences", f"/groups/{gid}/preferences", params={"userId": "all"})
        if not res.ok:
            state.failed_tools.add("get_wants")
            state.done_labels["get_wants"] = "Couldn't read what everyone wants"
            return res.error
        wants: dict[str, list[str]] = {}
        for p in res.data if isinstance(res.data, list) else []:
            name = _clip(((p.get("item") or {}).get("name") or "").strip(), 60)
            who = ((p.get("user") or {}).get("displayName") or "").strip()
            if name:
                bucket = wants.setdefault(name, [])
                if who and who not in bucket:
                    bucket.append(who)
        state.done_labels["get_wants"] = "Checked what everyone wants"
        return _j([f"{n} ({', '.join(w)})" if w else n for n, w in list(wants.items())[:20]])

    # ── safety ───────────────────────────────────────────────────────────────

    async def _check(meals: list[dict[str, Any]]) -> tuple[list[SafetyMealOut], list[SafetyMealOut], str]:
        """Check normalized meals (+ To buy). Returns (real meal results, To buy results, error)."""
        try:
            body = SafetyCheckBody.model_validate({"meals": safety_payload(meals)})
        except ValidationError as e:
            return [], [], "error: invalid meals for safety check: " + _validation_text(e)
        res = await client.post("safety check", f"/groups/{gid}/agent/safety-check", body.model_dump())
        if not res.ok:
            return [], [], res.error
        try:
            parsed = SafetyCheckResponse.model_validate(res.data)
        except ValidationError:
            return [], [], "error: safety check returned invalid data"
        if len(parsed.meals) != len(body.meals):
            return [], [], "error: safety check did not cover every meal"
        n = len(meals)
        return parsed.meals[:n], parsed.meals[n:], ""

    def _problem_text(m: SafetyMealOut) -> str:
        return f"{m.title}: " + ", ".join(f"{p.ingredient} ({p.reason}; {', '.join(p.members)})" for p in m.problems)

    def _maybe_price() -> None:
        """Start background pricing once every drafted meal (and To buy) is safe."""
        if not state.draft_meals or state.pending_finds > 0:
            return  # wait until every parallel find_recipe has landed so the final name set is priced once
        if all((r := state.safety_by_title.get(t)) is not None and r.passes for t in state.draft_meals):
            # Only the meals that will ship (propose_plan caps at MAX_MEALS), so the priced set matches the final one.
            kept = list(state.draft_meals.values())[:MAX_MEALS]
            pricer.start(_unique(n for m in kept for n in m["missing"]))

    def _invalidate() -> None:
        state.draft_meals = {}
        state.safety_by_title = {}
        state.to_buy_ok = False

    @tool
    async def check_meal_safety(meals: list[dict[str, Any]]) -> str:
        """Deterministic allergy/diet safety check. Pass ALL meals once as FULL meals:
        {"title","ingredients":[...],"day","minutes","servings","missing":[...],"steps":[...]}.
        Your last call defines the plan that propose_plan submits. Returns all_pass or the failed meals."""
        new = [normalize_meal(m) for m in strip_nul(meals) if isinstance(m, dict)]
        # Meals already found with find_recipe (cited) stay in the plan; the model only adds its own fallback meals.
        kept = [m for t, m in state.draft_meals.items() if m.get("source") and t not in {n["title"] for n in new}]
        if len(kept) >= MAX_MEALS:  # everything is already found and checked: don't redraft it
            return _j({"all_pass": True, "note": f"{len(kept)} cited meals are already stored; call propose_plan now"})
        norm = [*kept, *new][:MAX_MEALS]
        real, extra, err = await _check(norm) if norm else ([], [], "error: no meals given")
        if err:
            _invalidate()  # unknown state: propose_plan must be preceded by a fresh check
            state.failed_tools.add("check_meal_safety")
            state.done_labels["check_meal_safety"] = "Safety check unavailable"
            return err
        state.draft_meals = {m["title"]: m for m in norm}
        state.safety_by_title = {r.title: r for r in real}
        state.to_buy_ok = all(r.passes for r in extra)
        n, ok = len(real), sum(1 for r in real if r.passes)
        failed = [r for r in [*real, *extra] if not r.passes]
        label = f"Safety check: {ok}/{n} pass"
        if failed:
            bad = [p.ingredient for r in failed for p in r.problems][:2]
            label += f" · {len(failed)} failed: {', '.join(bad)}, fixing…" if bad else f" · {len(failed)} failed, fixing…"
        state.done_labels["check_meal_safety"] = _clip(label, 200)
        if not failed:
            _maybe_price()
            unknown = sorted({u for r in real for u in r.unknown})
            return _j({"all_pass": True, **({"unknown": unknown} if unknown else {})})
        return _j({
            "all_pass": False,
            "failed": [{"title": r.title, "problems": [p.model_dump() for p in r.problems]} for r in failed],
            "instruction": _fix_instruction(failed),
        })

    @tool
    async def revise_meal(
        title: str,
        remove: list[str] | None = None,
        add: list[str] | None = None,
        steps: list[str] | None = None,
        new_title: str = "",
    ) -> str:
        """Patch ONE meal from your last check_meal_safety call and re-check only it: remove ingredient names,
        add ingredient names (items not in the cabinet become 'missing'), optionally replace its steps and/or title."""
        key = " ".join(str(title).split())
        meal = state.draft_meals.get(key)
        if meal is None:
            known = ", ".join(state.draft_meals) or "none"
            return f"error: no drafted meal '{key}' (known: {known}). Run check_meal_safety first."
        rm = {_norm(x) for x in strip_nul(remove or [])}
        ingredients = [i for i in meal["ingredients"] if _norm(i) not in rm]
        missing = [i for i in meal["missing"] if _norm(i) not in rm]
        for a in _strs(strip_nul(add or [])):
            if _norm(a) not in {_norm(i) for i in ingredients}:
                ingredients.append(a)
            if _norm(a) not in state.cabinet_names and _norm(a) not in {_norm(i) for i in missing}:
                missing.append(a)
        new = normalize_meal({
            **meal, "title": (strip_nul(new_title).strip() or key), "ingredients": ingredients, "missing": missing,
            "steps": _strs(strip_nul(steps)) or meal["steps"],
        })
        if not new["ingredients"]:
            return "error: a meal needs at least one ingredient"
        if new.get("source") and (rm or add):
            new = {**new, "source": None, "ingredientLines": []}  # edited: it no longer matches the cited recipe
        drafts = {(new["title"] if t == key else t): (new if t == key else d) for t, d in state.draft_meals.items()}
        # Re-check only this meal; the To buy entry is recomputed over every drafted meal.
        names = _unique(n for d in drafts.values() for n in d["missing"])
        try:
            body = SafetyCheckBody.model_validate({"meals": [
                {"title": new["title"], "steps": new["steps"][:6], "ingredientLines": _lines(new),
                 "ingredients": _unique([*new["ingredients"], *new["missing"], *new["uses"]])[:25]},
                *([{"title": TO_BUY, "ingredients": names[:25]}] if names else []),
            ]})
        except ValidationError as e:
            return "error: invalid meal: " + _validation_text(e)
        res = await client.post("safety check", f"/groups/{gid}/agent/safety-check", body.model_dump())
        parsed: SafetyCheckResponse | None = None
        if res.ok:
            try:
                parsed = SafetyCheckResponse.model_validate(res.data)
            except ValidationError:
                parsed = None
        if parsed is None or len(parsed.meals) != len(body.meals):
            _invalidate()
            state.failed_tools.add("revise_meal")
            state.done_labels["revise_meal"] = "Couldn't re-check the meal"
            return res.error if not res.ok else "error: safety check returned invalid data; run check_meal_safety first"
        mine, to_buy = parsed.meals[0], parsed.meals[1:]
        state.draft_meals = drafts
        state.safety_by_title = {t: r for t, r in state.safety_by_title.items() if t != key}
        state.safety_by_title[new["title"]] = mine
        state.to_buy_ok = all(r.passes for r in to_buy)
        bad = [r for r in [mine, *to_buy] if not r.passes]
        state.done_labels["revise_meal"] = _clip(
            f"Fixed {new['title']}" if not bad else f"Still failing: {', '.join(p.ingredient for r in bad for p in r.problems[:2])}", 200
        )
        _maybe_price()
        if bad:
            return _j({"passes": False, "instruction": _fix_instruction(bad),
                       "failed": [{"title": r.title, "problems": [p.model_dump() for p in r.problems]} for r in bad]})
        all_ok = all(r.passes for r in state.safety_by_title.values()) and len(state.safety_by_title) == len(drafts)
        return _j({"passes": True, "title": new["title"], "all_meals_pass": all_ok})

    # ── find_recipe (cited web recipes) ──────────────────────────────────────

    NOTE = ("No cited recipe available for this idea. Write the meal yourself (ingredients, missing, steps) and "
            "include it in check_meal_safety; it will be labeled AI-created.")
    basics = {_norm(b) for b in settings.pantry_basics}
    oils = {_norm(o) for o in settings.cooking_oils}

    def _owned() -> set[str]:
        return state.cabinet_names | state.list_names

    def _on_hand_basic(name: str) -> bool:
        """Salt, black pepper, water... and any cooking oil when the cabinet has some oil: never added to the list."""
        n = _norm(name)
        # suffix match: "Kosher Salt" -> salt, "Nonstick Cooking Spray" -> cooking spray (but not "Water Chestnuts")
        if any(n == b or n.endswith(" " + b) for b in basics):
            return True
        return n in oils and any("oil" in c.split() for c in state.cabinet_names)

    def _join(names: list[str]) -> str:
        return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]

    def _meal_from(r: ParsedRecipe) -> dict[str, Any]:
        owned = _owned()
        ings = r.ingredients[:25]
        missing = [i for i in ings if not have_item(i, owned) and not _on_hand_basic(i)][:15]
        core = [i for i in ings if i not in missing][:3] or ings[:3]
        # Generic fallback steps; find_recipe replaces them with model-written ones in its own words when it can.
        steps = [f"Prep {_join(core)}.", "Cook everything as directed in the linked recipe.", "Season to taste and serve."]
        return normalize_meal({
            "title": _clip(r.title, 120), "day": None, "minutes": r.minutes, "servings": r.servings,
            "ingredients": ings, "missing": missing, "steps": steps,
            "source": {"url": r.url, "site": r.site, "title": r.title, "imageUrl": r.image},
            "ingredientLines": r.lines,
        })

    def _score(r: ParsedRecipe, must_use: list[str]) -> int:
        owned = _owned()
        have = sum(1 for g in r.ingredients if have_item(g, owned))
        wanted = sum(1 for mu in must_use if have_item(mu, set(r.ingredients)))
        return have + 3 * wanted  # prefer recipes that use the expiring items, then ones the cabinet mostly covers

    async def _batch(payload: list[dict[str, Any]]) -> list[SafetyMealOut] | None:
        try:
            body = SafetyCheckBody.model_validate({"meals": payload})
        except ValidationError:
            return None
        res = await client.post("safety check", f"/groups/{gid}/agent/safety-check", body.model_dump())
        if not res.ok:
            return None
        try:
            parsed = SafetyCheckResponse.model_validate(res.data)
        except ValidationError:
            return None
        return parsed.meals if len(parsed.meals) == len(payload) else None

    async def _find(idea: str, key: str, must_use: list[str], avoid: list[str]) -> str:
        tried: set[str] = set()
        winner = None
        source = ""
        # 1) our own recipe index (Akamai embeddings, allergen-prefiltered by the server), then the same safety check
        if recipe_index:
            cands = await _index_candidates(idea, must_use, avoid)
            if cands:
                winner = await _pick(cands, must_use, tried, "index")
                if winner:
                    source = "index"
                else:
                    log.info("find_recipe %r: no safe recipe in the %d index results", idea, len(cands))
        # 2) fallback: live web search (Tavily), unchanged
        if winner is None and recipes is not None and recipes.enabled:
            terms = exclusion_terms(state.household)  # "dairy-free", "vegetarian": fewer candidates fail safety
            core = must_use[0] if must_use else idea.split()[-1]
            queries = [
                " ".join([f"{idea} recipe" + (f" with {', '.join(must_use[:3])}" if must_use else ""), *terms]),
                " ".join([f"{core} easy dinner recipe", *terms]),  # ONE simpler retry when nothing passes
            ]
            for attempt, query in enumerate(queries):
                winner = await _round(query, must_use, avoid, tried)
                if winner:
                    source = "tavily"
                    break
                log.info("find_recipe %r: no safe recipe on attempt %d", idea, attempt + 1)
        if winner is None:
            state.done_labels[key] = ("No safe recipe found, writing it myself" if (recipe_index or (recipes and recipes.enabled))
                                      else "Writing this one myself")
            return _j({"found": False, "note": NOTE})
        meal, rec, res = winner
        log.info("find_recipe %r: %s hit %s", idea, source, rec.url)
        # Real cooking guidance in the model's own words (outline = first ~10 words of each source step, never the
        # full text); re-checked because apply checks steps. Falls back to the generic steps on any problem.
        steps = await write_steps(steps_factory, rec, meal["ingredients"])
        if steps:
            cand = normalize_meal({**meal, "steps": steps})
            chk = await _batch(safety_payload([cand], to_buy=False))
            if chk and chk[0].passes:
                meal = cand
            else:
                why = "; ".join(f"{p.reason} ({p.ingredient})" for p in (chk[0].problems if chk else [])[:3]) or "no result"
                log.info("model-written steps rejected (%s); using generic steps", why)
        state.draft_meals[meal["title"]] = meal
        state.safety_by_title[meal["title"]] = SafetyMealOut(title=meal["title"], passes=True, problems=[], unknown=res.unknown)
        state.used_urls.add(rec.url)
        state.done_labels[key] = _clip(f"Found: {rec.title} ({rec.site})", 200)
        # Minimal result (tokens): the full meal, steps and lines stay in run state for propose_plan.
        return _j({"found": True, "title": meal["title"], "site": rec.site, "uses": meal["uses"][:8],
                   "missing": meal["missing"]})

    async def _index_candidates(idea: str, must_use: list[str], avoid: list[str]) -> list[ParsedRecipe] | None:
        """Top matches from the server's recipe index, or None when it is unavailable / errors (-> Tavily fallback)."""
        try:
            body = RecipeSearchBody(query=idea[:200], mustUse=must_use[:10], limit=6)
        except ValidationError:
            return None
        res = await client.post("recipe search", f"/groups/{gid}/agent/recipes/search", body.model_dump())
        if not res.ok:
            log.info("recipe index error: %s", res.error)
            return None
        try:
            parsed = RecipeSearchResponse.model_validate(res.data)
        except ValidationError:
            log.info("recipe index returned an unexpected shape")
            return None
        if not parsed.available:
            log.info("recipe index not available")
            return None
        bad = {a.lower() for a in avoid}
        out = []
        for r in parsed.recipes:
            if bad and any(b in g.lower() for g in r.ingredients for b in bad):
                log.info("recipe candidate rejected: %s: has an avoided ingredient", r.url)
                continue
            out.append(ParsedRecipe(
                url=r.url, site=r.site, title=r.title, image=r.imageUrl, minutes=r.minutes or 30,
                servings=r.servings or 4, lines=r.ingredientLines, step_count=0, ingredients=r.ingredients[:25],
                outline=[], minutes_src=r.minutes, servings_src=r.servings))  # no instructions are stored in the index
        return out

    async def _round(query: str, must_use: list[str], avoid: list[str], tried: set[str]):
        """Tavily: one search + parallel fetch + ranked batch safety check. Returns (meal, recipe, result) or None."""
        cands, rejects = await recipes.candidates(query, avoid, state.used_urls | tried)
        for r in rejects:
            log.info("recipe candidate rejected: %s", r)
        return await _pick(cands, must_use, tried, "tavily")

    async def _pick(cands: list[ParsedRecipe], must_use: list[str], tried: set[str], origin: str):
        """Rank candidates, run ONE batched safety check, return the first passing (meal, recipe, result) or None."""
        cands = [c for c in cands if _clip(c.title, 120) not in state.draft_meals and c.url not in state.used_urls]
        tried.update(c.url for c in cands)
        ranked = sorted(enumerate(cands), key=lambda t: (-_score(t[1], must_use), t[0]))
        meals = [_meal_from(c) for _, c in ranked]
        recs = [c for _, c in ranked]
        # One batched check, exactly what apply checks: title, steps, ingredients, and the source's raw lines.
        results = await _batch(safety_payload(meals, to_buy=False)) if meals else None
        winner = None
        for i, res in enumerate(results or []):
            if res.passes:
                winner = winner or (meals[i], recs[i], res)
            else:
                why = "; ".join(f"{p.reason} ({p.ingredient})" for p in res.problems[:3]) or "failed"
                log.info("recipe candidate rejected: %s: unsafe: %s", recs[i].url, why)
        return winner

    @tool
    async def find_recipe(idea: str, must_use: list[str] | None = None, avoid: list[str] | None = None) -> str:
        """Find a real, cited web recipe for one meal idea (prefers recipes using the must_use cabinet items, skips
        ones with avoid items). A safe match is stored for propose_plan; do not re-send it. Call once per idea,
        all ideas in the same turn."""
        idea = " ".join(str(strip_nul(idea)).split())[:120] or "dinner"
        state.pending_finds += 1
        try:
            return await _find(idea, step_key(idea), _strs(strip_nul(must_use or []))[:5],
                               _strs(strip_nul(avoid or []))[:10])
        finally:
            state.pending_finds -= 1
            _maybe_price()

    # ── propose_plan ─────────────────────────────────────────────────────────

    def _meta() -> dict[str, Any]:
        tin, tout = state.usage() if state.usage else (None, None)
        if tin is not None:
            tin += state.extra_tokens_in
        if tout is not None:
            tout += state.extra_tokens_out
        return {"provider": settings.agent_provider, "model": model_id_for(settings.agent_provider, settings),
                "toolCalls": state.tool_calls, "tokensIn": tin, "tokensOut": tout, "ms": state.ms()}

    def _stop() -> None:
        if state.cancel:
            state.cancel()

    async def _reject(message: str) -> str:
        state.proposal_failures += 1
        log.info("run %s: proposal rejected (%d): %s", ctx.run_id, state.proposal_failures, message[:300])
        state.done_labels["propose_plan"] = "Fixing the plan…"
        limit = FAIL_LIMIT if state.ms() < LATE_MS else FAIL_LIMIT_LATE
        if state.proposal_failures >= limit:
            await sink.failed("I couldn't put together a safe, valid plan. Please try again.", _meta())
            state.failed_tools.add("propose_plan")
            state.done_labels["propose_plan"] = "Couldn't finish the plan"
            _stop()
            return message + " (final failure; the run has ended)"
        return message + " Fix the problem and call propose_plan again."

    @tool
    async def propose_plan(plan: dict[str, Any]) -> str:
        """Submit the final plan; the ONLY way to finish. Pass {"summary": "one sentence"} to submit the meals of
        your last check_meal_safety/revise_meal calls. Optional "add_missing": ["Cilantro", ...] appends fresh
        ingredients to the last meal. Returns "ok" or errors to fix."""
        plan = strip_nul(plan) if isinstance(plan, dict) else {}
        meals_in = plan.get("meals") or list(state.draft_meals.values())
        if not meals_in or not isinstance(meals_in, list):
            return await _reject("error: no meals to submit; run check_meal_safety first.")
        meals: list[Any] = []
        for m in meals_in:
            if isinstance(m, dict) and not m.get("ingredients"):  # lean meal: reuse the checked draft by title
                d = state.draft_meals.get(" ".join(str(m.get("title", "")).split()))
                if d:
                    m = {**d, **{k: v for k, v in m.items() if k not in ("ingredients", "missing", "uses")}}
            meals.append(normalize_meal(m))
        add = _strs(plan.get("add_missing"))[:8]
        if add and meals and isinstance(meals[-1], dict):
            last = meals[-1]
            meals[-1] = normalize_meal({**last, "ingredients": [*last["ingredients"], *add],
                                        "missing": [*last["missing"], *add]})
        summary = str(plan.get("summary") or "")[:400]
        if len(meals) > MAX_MEALS:
            note = f" Capped at {MAX_MEALS} meals."
            meals, summary = meals[:MAX_MEALS], summary[: 400 - len(note)].rstrip() + note
        try:
            draft = PlanDraft.model_validate({"meals": meals, "summary": summary})
        except ValidationError as e:
            return await _reject("error: invalid plan: " + _validation_text(e) + ".")

        # missingItems are always derived from the meals' `missing`, so the two can never disagree.
        by_name: dict[str, tuple[str, list[str]]] = {}
        for m in draft.meals:
            for n in m.missing:
                _, titles = by_name.setdefault(_norm(n), (n, []))
                if m.title not in titles and len(titles) < 7:
                    titles.append(m.title)
        missing_items = [PlanMissingItem(name=n, forMeals=t) for n, t in list(by_name.values())[:40]]
        if (not missing_items and len(draft.meals) >= 2 and not state.missing_nudged
                and state.ms() < NUDGE_BEFORE_MS):
            # One-time soft check (not counted as a failed proposal): a shopping plan needs things to buy.
            state.missing_nudged = True
            state.done_labels["propose_plan"] = "Adding fresh ingredients…"
            return ("error: no missing items. Call propose_plan again with the same summary plus "
                    "add_missing: [4 to 6 fresh ingredient names NOT in the cabinet or on the list].")

        norm_meals = [m.model_dump() for m in draft.meals]
        assign_days(norm_meals, (state.household or {}).get("today"))
        real, extra, err = await _check(norm_meals)
        if err:
            fatal = state.fatal_status is not None
            return await _reject(err + ".") if not fatal else err
        failed = [r for r in [*real, *extra] if not r.passes]
        if failed:
            return await _reject("error: unsafe, remove these everywhere (ingredients, titles, steps): "
                                 + "; ".join(_problem_text(r) for r in failed) + ".")
        state.draft_meals = {m["title"]: m for m in norm_meals}
        state.safety_by_title = {r.title: r for r in real}
        state.to_buy_ok = True

        est = await pricer.estimate_for([i.name for i in missing_items], PRICE_WAIT_S)
        full = {
            "meals": norm_meals,
            "missingItems": [i.model_dump() for i in missing_items],
            "summary": draft.summary,
            "estimate": {"lowCents": est[0], "highCents": est[1], "label": "AI estimate"} if est else None,
            # Built from THIS call's safety response for the FINAL meals; titles equal plan.meals[i].title.
            "safety": {"checked": True,
                       "perMeal": [{"title": m["title"], "passes": True, "unknown": real[i].unknown}
                                   for i, m in enumerate(norm_meals)]},
        }
        try:
            AgentPlan.model_validate(full)
        except ValidationError as e:
            return await _reject("error: invalid plan: " + _validation_text(e) + ".")
        # The server answers 409 to steps once `proposed` lands, so close this step first.
        state.done_labels.pop("propose_plan", None)
        await sink.step("propose_plan", "Plan ready", "done")
        status = await sink.proposed(full, _meta())
        if 200 <= status < 300:
            _stop()  # the run is finished; skip the model's closing chatter
            return "ok"
        if status in FATAL_STATUSES or status in (409, 422) or sink.closed:
            _stop()
            return "error: the server closed this run"
        return await _reject("error: couldn't submit the plan (server unavailable).")

    tools = [get_household, get_cabinet, get_shopping_list, get_wants, check_meal_safety, revise_meal, propose_plan]
    if recipe_index or (recipes is not None and recipes.enabled):
        tools.insert(4, find_recipe)
    return tools
