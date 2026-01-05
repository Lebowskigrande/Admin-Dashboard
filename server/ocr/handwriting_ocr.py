#!/usr/bin/env python3
import json
import os
import sys

os.environ["DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ.setdefault("PADDLE_LOG_LEVEL", "ERROR")

from paddleocr import PaddleOCR
from PIL import Image


def build_payload(image_path):
    with Image.open(image_path) as image:
        width, height = image.size

    ocr = PaddleOCR(use_textline_orientation=False, lang="en")
    results = ocr.ocr(image_path, cls=False) or []

    lines = []
    for result in results:
        for entry in result or []:
            if not entry or len(entry) < 2:
                continue
            box = entry[0]
            text_info = entry[1]
            text = text_info[0] if text_info else ""
            conf = text_info[1] if text_info and len(text_info) > 1 else None
            xs = [point[0] for point in box]
            ys = [point[1] for point in box]
            lines.append(
                {
                    "text": text,
                    "left": min(xs),
                    "top": min(ys),
                    "right": max(xs),
                    "bottom": max(ys),
                    "conf": conf,
                }
            )

    return {"width": width, "height": height, "lines": lines}


def main():
    if len(sys.argv) < 2:
        print("Usage: handwriting_ocr.py <image_path>", file=sys.stderr)
        sys.exit(1)

    image_path = sys.argv[1]
    payload = build_payload(image_path)
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
