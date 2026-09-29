#!/usr/bin/env python3
"""StormMap launcher.

    python3 server.py                 # http://localhost:8000
    python3 server.py --port 9000
    python3 server.py --demo          # offline synthetic data (no internet needed)
"""

import argparse
import logging
import os
import sys


def main():
    ap = argparse.ArgumentParser(description="StormMap — storm analysis & tracking server")
    ap.add_argument("--host", default=os.environ.get("STORMMAP_HOST", "0.0.0.0"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("STORMMAP_PORT", "8000")))
    ap.add_argument("--demo", action="store_true", help="serve synthetic data without calling external APIs")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    if args.demo:
        os.environ["STORMMAP_DEMO"] = "1"

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from stormmap.app import serve  # imported after env so config sees --demo

    serve(args.host, args.port)


if __name__ == "__main__":
    main()
