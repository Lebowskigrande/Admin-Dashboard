#!/usr/bin/env python3
import base64
import io
import json
import os
import sys
import warnings
import subprocess
import tempfile

os.environ["DISABLE_MODEL_SOURCE_CHECK"] = "True"
os.environ.setdefault("PADDLE_LOG_LEVEL", "ERROR")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

DEFAULT_REGIONS = {
    "numericAmount": {"xMin": 0.73, "xMax": 0.96, "yMin": 0.56, "yMax": 0.69},
    "legalAmount": {"xMin": 0.08, "xMax": 0.86, "yMin": 0.47, "yMax": 0.58},
    "checkNumber": {"xMin": 0.7, "xMax": 0.96, "yMin": 0.86, "yMax": 0.95},
}


def load_regions():
    raw = os.environ.get("OCR_REGIONS")
    if not raw:
        return DEFAULT_REGIONS
    try:
        regions = json.loads(raw)
    except json.JSONDecodeError:
        return DEFAULT_REGIONS
    merged = DEFAULT_REGIONS.copy()
    merged.update(regions)
    return merged


def load_engines():
    raw = os.environ.get("OCR_ENGINES")
    if not raw:
        return ["trocr"]
    try:
        engines = json.loads(raw)
    except json.JSONDecodeError:
        engines = []
    return engines or ["trocr"]


def clamp(value, min_value=0.0, max_value=1.0):
    return max(min_value, min(max_value, value))


def crop_region(image, region):
    width, height = image.size
    x_min = int(clamp(region.get("xMin", 0)) * width)
    x_max = int(clamp(region.get("xMax", 1)) * width)
    y_min = clamp(region.get("yMin", 0))
    y_max = clamp(region.get("yMax", 1))
    origin = os.environ.get("OCR_REGION_ORIGIN", "top-left").lower()
    if origin == "bottom-left":
        y_min, y_max = 1.0 - y_max, 1.0 - y_min
    y_min = int(y_min * height)
    y_max = int(y_max * height)
    if x_max <= x_min or y_max <= y_min:
        return image
    return image.crop((x_min, y_min, x_max, y_max))

def set_region_y_from_px(region, y_top_px, y_bottom_px, height, origin):
    y_top_px = max(0, min(height, y_top_px))
    y_bottom_px = max(0, min(height, y_bottom_px))
    if y_bottom_px < y_top_px:
        y_top_px, y_bottom_px = y_bottom_px, y_top_px
    if origin == "bottom-left":
        y_min = 1.0 - (y_bottom_px / float(height))
        y_max = 1.0 - (y_top_px / float(height))
    else:
        y_min = y_top_px / float(height)
        y_max = y_bottom_px / float(height)
    return {**region, "yMin": clamp(y_min), "yMax": clamp(y_max)}


def set_region_box_from_px(region, x_min_px, x_max_px, y_top_px, y_bottom_px, width, height, origin):
    x_min_px = max(0, min(width, x_min_px))
    x_max_px = max(0, min(width, x_max_px))
    if x_max_px < x_min_px:
        x_min_px, x_max_px = x_max_px, x_min_px
    if origin == "bottom-left":
        y_min = 1.0 - (y_bottom_px / float(height))
        y_max = 1.0 - (y_top_px / float(height))
    else:
        y_min = y_top_px / float(height)
        y_max = y_bottom_px / float(height)
    x_min = x_min_px / float(width)
    x_max = x_max_px / float(width)
    return {
        **region,
        "xMin": clamp(x_min),
        "xMax": clamp(x_max),
        "yMin": clamp(y_min),
        "yMax": clamp(y_max),
    }


def tighten_to_ink(image, padding=12, min_ink_ratio=0.003):
    gray = np.array(image.convert("L"))
    if gray.size == 0:
        return image
    thresh = np.percentile(gray, 30)
    ink = gray < thresh
    ink_ratio = ink.mean()
    if ink_ratio < min_ink_ratio:
        return image
    coords = np.column_stack(np.where(ink))
    y_min, x_min = coords.min(axis=0)
    y_max, x_max = coords.max(axis=0)
    y_min = max(0, y_min - padding)
    x_min = max(0, x_min - padding)
    y_max = min(gray.shape[0], y_max + padding)
    x_max = min(gray.shape[1], x_max + padding)
    if y_max <= y_min or x_max <= x_min:
        return image
    return image.crop((x_min, y_min, x_max, y_max))

def crop_to_band(image, band_height_ratio=0.5, avoid_bottom_ratio=0.2):
    gray = np.array(image.convert("L"))
    if gray.size == 0:
        return image
    thresh = np.percentile(gray, 35)
    ink = gray < thresh
    row_density = ink.mean(axis=1)
    total_rows = row_density.shape[0]
    if total_rows == 0:
        return image
    start_row = int(total_rows * 0.05)
    end_row = int(total_rows * (1.0 - avoid_bottom_ratio))
    if end_row <= start_row:
        return image
    target = row_density[start_row:end_row]
    peak_index = int(np.argmax(target)) + start_row
    band_height = max(1, int(total_rows * band_height_ratio))
    half = band_height // 2
    y_min = max(0, peak_index - half)
    y_max = min(total_rows, peak_index + half)
    if y_max <= y_min:
        return image
    return image.crop((0, y_min, gray.shape[1], y_max))


def trim_right_block(image, right_ratio=0.3, density_threshold=0.08, padding=8):
    gray = np.array(image.convert("L"))
    if gray.size == 0:
        return image
    thresh = np.percentile(gray, 35)
    ink = gray < thresh
    col_density = ink.mean(axis=0)
    width = col_density.shape[0]
    if width == 0:
        return image
    right_start = int(width * (1.0 - right_ratio))
    right_density = col_density[right_start:]
    if right_density.size == 0:
        return image
    hit_indices = np.where(right_density > density_threshold)[0]
    if hit_indices.size == 0:
        return image
    block_start = right_start + int(hit_indices.min())
    x_max = max(1, block_start - padding)
    if x_max <= 0:
        return image
    return image.crop((0, 0, x_max, gray.shape[0]))


def find_underline_row(gray, min_density=0.3):
    thresh = np.percentile(gray, 35)
    ink = gray < thresh
    row_density = ink.mean(axis=1)
    if row_density.size == 0:
        return None
    max_idx = int(np.argmax(row_density))
    if row_density[max_idx] < min_density:
        return None
    return max_idx


def refine_legal_crop(crop):
    gray = np.array(crop.convert("L"))
    if gray.size == 0:
        return crop
    underline = find_underline_row(gray, min_density=0.25)
    if underline is not None:
        top = max(0, underline - int(gray.shape[0] * 0.6))
        bottom = min(gray.shape[0], underline + int(gray.shape[0] * 0.15))
        if bottom > top:
            crop = crop.crop((0, top, gray.shape[1], bottom))
    crop = trim_right_block(crop, right_ratio=0.25, density_threshold=0.06, padding=6)
    return crop


def refine_numeric_crop(crop):
    gray = np.array(crop.convert("L"))
    if gray.size == 0:
        return crop
    thresh = np.percentile(gray, 35)
    ink = gray < thresh
    col_density = ink.mean(axis=0)
    width = col_density.shape[0]
    if width == 0:
        return crop
    left_band = col_density[: max(1, int(width * 0.35))]
    peak = int(np.argmax(left_band))
    if left_band[peak] > 0.05:
        x_min = min(width - 1, peak + int(width * 0.04))
        crop = crop.crop((x_min, 0, width, gray.shape[0]))
    crop = crop_to_band(crop, band_height_ratio=0.45, avoid_bottom_ratio=0.25)
    return crop


def preprocess(image):
    image = image.convert("L")
    image = ImageOps.autocontrast(image)
    image = ImageEnhance.Contrast(image).enhance(2.0)
    image = image.filter(ImageFilter.SHARPEN)
    return image.convert("RGB")


def find_check_bounds(gray, padding=0):
    height, width = gray.shape
    if height == 0 or width == 0:
        return (0, 0, width, height)
    thresh = np.percentile(gray, 75)
    ink = gray < thresh
    row_density = ink.mean(axis=1)
    col_density = ink.mean(axis=0)
    row_thresh = max(0.01, float(np.percentile(row_density, 60)))
    col_thresh = max(0.01, float(np.percentile(col_density, 60)))

    rows = np.where(row_density > row_thresh)[0]
    cols = np.where(col_density > col_thresh)[0]
    if rows.size == 0 or cols.size == 0:
        return (0, 0, width, height)
    y_min = int(rows.min())
    y_max = int(rows.max())
    x_min = int(cols.min())
    x_max = int(cols.max())
    x_min = max(0, x_min - padding)
    y_min = max(0, y_min - padding)
    x_max = min(width, x_max + padding)
    y_max = min(height, y_max + padding)
    return (x_min, y_min, x_max, y_max)


def estimate_skew_angle(gray, max_angle=3, step=0.5, band_ratio=0.2, scale=0.4):
    height, width = gray.shape
    if height == 0 or width == 0:
        return 0.0
    if scale and 0 < scale < 1:
        small = Image.fromarray(gray).resize(
            (max(1, int(width * scale)), max(1, int(height * scale))),
            resample=Image.BILINEAR,
        )
        gray = np.array(small)
        height, width = gray.shape

    band_height = max(1, int(height * band_ratio))
    angles = np.arange(-max_angle, max_angle + step, step)
    best_angle = 0.0
    best_score = -1.0
    baseline_score = None
    for angle in angles:
        rotated = Image.fromarray(gray).rotate(angle, expand=True, fillcolor=255)
        r = np.array(rotated)
        if r.size == 0:
            continue
        band = r[-band_height:, :]
        thresh = np.percentile(band, 35)
        ink = band < thresh
        row_density = ink.mean(axis=1)
        score = float(row_density.var())
        if angle == 0:
            baseline_score = score
        if score > best_score:
            best_score = score
            best_angle = angle
    if baseline_score is None:
        return float(best_angle)
    if best_score - baseline_score < 0.0005:
        return 0.0
    return float(best_angle)


def align_check(image, enabled, padding, max_angle, step, band_ratio, scale):
    if not enabled:
        return image
    gray = np.array(image.convert("L"))
    bounds = find_check_bounds(gray, padding=padding)
    x_min, y_min, x_max, y_max = bounds
    cropped = image.crop((x_min, y_min, x_max, y_max))
    gray_crop = np.array(cropped.convert("L"))
    angle = estimate_skew_angle(gray_crop, max_angle=max_angle, step=step, band_ratio=band_ratio, scale=scale)
    if abs(angle) < 0.1:
        return cropped
    rotated = cropped.rotate(angle, expand=True, fillcolor="white")
    gray_rot = np.array(rotated.convert("L"))
    x_min, y_min, x_max, y_max = find_check_bounds(gray_rot, padding=padding)
    return rotated.crop((x_min, y_min, x_max, y_max))


def detect_micr_band(gray):
    height = gray.shape[0]
    band_start = int(height * 0.8)
    band = gray[band_start:height, :]
    median = float(gray.mean())
    diff = abs(gray.astype("float32") - median)
    dev_thresh = float(np.percentile(diff, 75))
    activity = (diff > dev_thresh).mean(axis=1)
    if activity.size == 0:
        return None
    threshold = max(float(np.percentile(activity, 75)), 0.08)

    best_start = None
    best_end = None
    current_start = None
    for idx, value in enumerate(activity):
        if value >= threshold:
            if current_start is None:
                current_start = idx
        else:
            if current_start is not None:
                end = idx
                if best_start is None or (end - current_start) > (best_end - best_start):
                    best_start = current_start
                    best_end = end
                current_start = None
    if current_start is not None:
        end = activity.size
        if best_start is None or (end - current_start) > (best_end - best_start):
            best_start = current_start
            best_end = end

    if best_start is None:
        return None
    micr_top = band_start + best_start
    micr_bottom = band_start + best_end
    return micr_top, micr_bottom

def tighten_micr_bounds(gray, micr_top, micr_bottom):
    height, width = gray.shape
    micr_top = max(0, min(height, micr_top))
    micr_bottom = max(0, min(height, micr_bottom))
    if micr_bottom <= micr_top:
        return micr_top, micr_bottom, 0, width
    band = gray[micr_top:micr_bottom, :]
    thresh = np.percentile(band, 35)
    ink = band < thresh
    if ink.mean() < 0.002:
        return micr_top, micr_bottom, 0, width
    coords = np.column_stack(np.where(ink))
    if coords.size == 0:
        return micr_top, micr_bottom, 0, width
    y_min, x_min = coords.min(axis=0)
    y_max, x_max = coords.max(axis=0)
    return micr_top + y_min, micr_top + y_max, x_min, x_max


def adjust_regions_for_micr(regions, micr_top_norm, micr_bottom_norm, anchor_region):
    if micr_top_norm is None or micr_bottom_norm is None or not anchor_region:
        return regions
    desired_top = anchor_region.get("yMin")
    desired_bottom = anchor_region.get("yMax")
    if desired_top is None or desired_bottom is None:
        return regions
    actual_height = max(1e-6, micr_bottom_norm - micr_top_norm)
    desired_height = max(1e-6, desired_bottom - desired_top)
    scale = desired_height / actual_height
    shift = desired_top - (micr_top_norm * scale)

    adjusted = {}
    for key, region in regions.items():
        if key == "micr":
            adjusted[key] = region
            continue
        y_min = clamp(region.get("yMin", 0) * scale + shift)
        y_max = clamp(region.get("yMax", 1) * scale + shift)
        adjusted[key] = {**region, "yMin": y_min, "yMax": y_max}
    return adjusted


def load_trocr(model_name):
    from transformers import TrOCRProcessor, VisionEncoderDecoderModel

    processor = TrOCRProcessor.from_pretrained(model_name)
    model = VisionEncoderDecoderModel.from_pretrained(model_name)
    return processor, model


def trocr_ocr(image, processor, model):
    pixel_values = processor(images=image, return_tensors="pt").pixel_values
    generated_ids = model.generate(pixel_values)
    return processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()


def paddle_ocr(image):
    try:
        import numpy as np
        from paddleocr import PaddleOCR
    except Exception:
        raise ImportError("paddleocr is not installed")

    ocr = PaddleOCR(
        use_textline_orientation=False,
        lang="en",
        text_det_thresh=0.1,
        text_det_box_thresh=0.1,
        text_det_unclip_ratio=1.6,
        text_det_limit_side_len=2000,
        text_det_limit_type="max",
    )
    image_array = np.array(image)
    try:
        results = ocr.ocr(image_array) or []
    except Exception:
        try:
            results = ocr.ocr(image) or []
        except Exception:
            return ""

    pieces = []
    for result in results:
        for entry in result or []:
            if not entry or len(entry) < 2:
                continue
            text_info = entry[1]
            text = text_info[0] if text_info else ""
            if text:
                pieces.append(text)
    return " ".join(pieces).strip()


def can_use_paddle(errors):
    try:
        import paddleocr  # noqa: F401
        return True
    except Exception as exc:
        errors.append(f"paddle: {exc}")
        return False


def micr_ocr_tesseract(image):
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            image.save(tmp.name, format="PNG")
            tmp_path = tmp.name
        micr_lang = os.environ.get("MICR_TESS_LANG", "").strip() or "eng"
        base_args = [
            "tesseract",
            tmp_path,
            "stdout",
            "-l",
            micr_lang,
            "--psm",
            "7",
            "--oem",
            "1",
        ]
        config_args = []
        if micr_lang == "eng":
            config_args = [
                "-c",
                "tessedit_char_whitelist=0123456789",
                "-c",
                "classify_bln_numeric_mode=1",
            ]
        result = subprocess.run(
            base_args + config_args,
            capture_output=True,
            text=True,
            check=False,
        )
        return result.stdout.strip()
    except Exception:
        return ""
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def build_payload(image_path):
    regions = load_regions()
    engines = load_engines()
    errors = []
    include_previews = os.environ.get("OCR_DEBUG_IMAGES") == "1"
    origin = os.environ.get("OCR_REGION_ORIGIN", "top-left").lower()
    anchor = os.environ.get("OCR_REGION_ANCHOR", "none").lower()
    model_name = os.environ.get("OCR_TROCR_MODEL", "").strip() or "microsoft/trocr-small-handwritten"
    crop_max = os.environ.get("OCR_CROP_MAX_SIZE", "").strip()
    preview_only = os.environ.get("OCR_PREVIEW_ONLY") == "1"
    try:
        crop_max = int(crop_max) if crop_max else None
    except ValueError:
        crop_max = None

    align_enabled = os.environ.get("OCR_ALIGN") == "1"
    bounds_padding = int(os.environ.get("OCR_BOUNDS_PADDING") or 0)
    max_angle = float(os.environ.get("OCR_DESKEW_MAX_ANGLE") or 3)
    angle_step = float(os.environ.get("OCR_DESKEW_STEP") or 0.5)
    band_ratio = float(os.environ.get("OCR_DESKEW_BAND") or 0.2)
    deskew_scale = float(os.environ.get("OCR_DESKEW_SCALE") or 0.4)

    with Image.open(image_path) as image:
        image = preprocess(image)
        image = align_check(image, align_enabled, bounds_padding, max_angle, angle_step, band_ratio, deskew_scale)
        width, height = image.size
        gray = np.array(image.convert("L"))

        micr_bounds = detect_micr_band(gray) if anchor == "micr" else None
        micr_top_norm = None
        micr_bottom_norm = None
        micr_top_px = None
        micr_box = None
        if micr_bounds:
            micr_top, micr_bottom = micr_bounds
            micr_top, micr_bottom, micr_left, micr_right = tighten_micr_bounds(gray, micr_top, micr_bottom)
            micr_top_px = micr_top
            micr_box = {
                "top": int(micr_top),
                "bottom": int(micr_bottom),
                "left": int(micr_left),
                "right": int(micr_right),
            }
            if origin == "bottom-left":
                micr_top_norm = 1.0 - (micr_top / float(height))
                micr_bottom_norm = 1.0 - (micr_bottom / float(height))
                if micr_top_norm < micr_bottom_norm:
                    micr_top_norm, micr_bottom_norm = micr_bottom_norm, micr_top_norm
            else:
                micr_top_norm = micr_top / float(height)
                micr_bottom_norm = micr_bottom / float(height)
            regions["micr"] = set_region_box_from_px(
                regions.get("micr", {}),
                micr_left,
                micr_right,
                micr_top,
                micr_bottom,
                width,
                height,
                origin,
            )

        if anchor == "micr" and micr_top_px is not None:
            legal_top_px = micr_top_px - (0.34 * height)
            legal_bottom_px = legal_top_px + (0.11 * height)
            numeric_top_px = micr_top_px - (0.37 * height)
            numeric_bottom_px = numeric_top_px + (0.12 * height)
            regions["legalAmount"] = set_region_y_from_px(
                regions.get("legalAmount", {}),
                legal_top_px,
                legal_bottom_px,
                height,
                origin,
            )
            regions["numericAmount"] = set_region_y_from_px(
                regions.get("numericAmount", {}),
                numeric_top_px,
                numeric_bottom_px,
                height,
                origin,
            )
            regions["checkNumber"] = set_region_box_from_px(
                regions.get("checkNumber", {}),
                micr_box["left"] if micr_box else 0,
                micr_box["right"] if micr_box else width,
                micr_box["top"] if micr_box else micr_top_px,
                micr_box["bottom"] if micr_box else micr_top_px,
                width,
                height,
                origin,
            )

        trocr_processor = None
        trocr_model = None
        if "trocr" in engines and not preview_only:
            try:
                trocr_processor, trocr_model = load_trocr(model_name)
            except Exception as exc:
                trocr_processor, trocr_model = None, None
                errors.append(f"trocr: {exc}")

        paddle_available = "paddle" in engines and not preview_only and can_use_paddle(errors)

        region_results = {}
        for key, region in regions.items():
            crop = crop_region(image, region)
            if not preview_only:
                if key in ("numericAmount", "legalAmount", "checkNumber"):
                    crop = tighten_to_ink(crop)
                if key == "numericAmount":
                    crop = refine_numeric_crop(crop)
                if key == "legalAmount":
                    crop = refine_legal_crop(crop)
            if crop_max:
                crop.thumbnail((crop_max, crop_max))
            candidates = {}

            if key != "micr":
                if "trocr" in engines and trocr_processor and trocr_model:
                    candidates["trocr"] = trocr_ocr(crop, trocr_processor, trocr_model)

                if "paddle" in engines and paddle_available:
                    try:
                        candidates["paddle"] = paddle_ocr(crop)
                    except Exception as exc:
                        errors.append(f"paddle: {exc}")
            if key == "micr" and not preview_only:
                candidates["tesseract"] = micr_ocr_tesseract(crop)

            chosen_engine = ""
            chosen_text = ""
            if key == "micr":
                best_digits = ""
                for engine, text in candidates.items():
                    digits = "".join([ch for ch in text if ch.isdigit()])
                    if len(digits) > len(best_digits):
                        best_digits = digits
                        chosen_engine = engine
                        chosen_text = digits or text
            elif key == "checkNumber":
                best_digits = ""
                for engine, text in candidates.items():
                    digits = "".join([ch for ch in text if ch.isdigit()])
                    if len(digits) > len(best_digits):
                        best_digits = digits
                        chosen_engine = engine
                        chosen_text = digits or text
            elif key == "numericAmount":
                for engine, text in candidates.items():
                    if any(ch.isdigit() for ch in text) and len(text) >= len(chosen_text):
                        chosen_text = text
                        chosen_engine = engine
            else:
                for engine, text in candidates.items():
                    if len(text) > len(chosen_text):
                        chosen_text = text
                        chosen_engine = engine

            region_results[key] = {
                "text": chosen_text.strip(),
                "engine": chosen_engine,
                "candidates": candidates,
            }
            if include_previews:
                preview = crop.copy()
                preview.thumbnail((600, 600))
                buffer = io.BytesIO()
                preview.save(buffer, format="PNG")
                region_results[key]["previewBase64"] = base64.b64encode(buffer.getvalue()).decode("ascii")

    payload = {
        "width": width,
        "height": height,
        "lines": [],
        "regions": region_results,
        "engines": engines,
        "errors": errors,
        "micrTopNorm": micr_top_norm,
        "micrTopPx": micr_top_px,
        "micrBottomNorm": micr_bottom_norm,
        "micrBox": micr_box,
        "previewOnly": preview_only,
    }
    if include_previews:
        preview = image.copy()
        preview.thumbnail((800, 800))
        buffer = io.BytesIO()
        preview.save(buffer, format="PNG")
        payload["alignedPreviewBase64"] = base64.b64encode(buffer.getvalue()).decode("ascii")
    return payload


def main():
    warnings.filterwarnings("ignore")
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: handwriting_ocr.py <image_path>", "lines": []}))
        return

    image_path = sys.argv[1]
    try:
        payload = build_payload(image_path)
    except Exception as exc:
        payload = {"error": str(exc), "lines": []}
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
