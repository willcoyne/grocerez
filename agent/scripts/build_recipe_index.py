"""Crawl the allowlisted recipe sites and send IndexedRecipe batches to the server (spec section 12).

  cd agent && .venv/bin/python3 scripts/build_recipe_index.py --dry-run --per-domain 5      # try it, sends nothing
  cd agent && .venv/bin/python3 scripts/build_recipe_index.py --per-domain 300 --resume     # the real crawl

Polite by construction: robots.txt (Disallow + Crawl-delay) is respected, at most 1 request/s per host (hosts run
concurrently), https + allowlisted hosts only, 2 MB page cap. Only ingredient lines and metadata are stored or sent,
never the site's instructions. Progress is kept in agent/.index-state.json so --resume skips finished URLs.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings  # noqa: E402
from app.indexer import Batcher, Crawler, DomainStats, Poster, StateFile  # noqa: E402

STATE_PATH = Path(__file__).resolve().parents[1] / ".index-state.json"


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--per-domain", type=int, default=300, help="max recipes parsed per domain (default 300)")
    p.add_argument("--max-total", type=int, default=None, help="stop after this many recipes in total")
    p.add_argument("--domains", nargs="*", default=None, help="only these domains (default: the configured allowlist)")
    p.add_argument("--dry-run", action="store_true", help="crawl and parse, but send nothing and write no state")
    p.add_argument("--resume", action="store_true", help=f"skip URLs already done in {STATE_PATH.name}")
    p.add_argument("--refresh", action="store_true",
                   help="re-fetch and re-send URLs that are already indexed (ignores the resume skip), e.g. to add `course`")
    p.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3000"),
                   help="server base URL (default $SERVER_URL or http://localhost:3000)")
    p.add_argument("--seed", type=int, default=0, help="shuffle seed for sampling URLs from the sitemaps")
    return p


async def run(args: argparse.Namespace, *, settings=None, limiter=None, state_path: Path = STATE_PATH) -> list[DomainStats]:
    settings = settings or get_settings()
    domains = args.domains or list(settings.recipe_domains)
    state = StateFile(None if args.dry_run else state_path, resume=args.resume or args.refresh, refresh=args.refresh)
    poster = None if args.dry_run else Poster(args.server, settings.agent_shared_secret)
    batcher = Batcher(poster, state)
    crawler = Crawler(settings, per_domain=args.per_domain, max_total=args.max_total, state=state, seed=args.seed,
                      limiter=limiter)
    try:
        stats = await crawler.crawl(domains, batcher.add)
        await batcher.flush()
    finally:
        if poster:
            await poster.aclose()
        state.save()
    print("\nPer-domain summary" + (" (dry run: nothing sent)" if args.dry_run else ""))
    for s in sorted(stats, key=lambda x: x.domain):
        print("  " + s.line())
    tried = sum(s.tried for s in stats)
    parsed = sum(s.parsed for s in stats)
    print(f"\nTotal: tried={tried} parsed={parsed} ({100 * parsed // tried if tried else 0}%) batches={batcher.batches}")
    if poster:
        print(f"Server: upserted={poster.upserted} embedded={poster.embedded} failed_batches={poster.failed_batches}")
    return stats


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s %(message)s")
    args = build_parser().parse_args(argv)
    asyncio.run(run(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
