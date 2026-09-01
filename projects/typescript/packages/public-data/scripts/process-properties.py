# /// script
# dependencies = [
#     "opencv-python-headless==5.0.0.93",
# ]
# ///

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import time
from typing import Any

import cv2
import numpy as np


EXPECTED_RESPONSE_SHA256 = "4448dcb7ef244de47e75877100cc2526ef419ca4943bf1d55abc3f7f3ec88ec4"
EXPECTED_DATASET_SHA256 = "5ee8e697d8ba3eaad5e1eed7ddb2a2ebfa39bb591fc629290d0d05d609190a90"
EXPECTED_GAME_VERSION = "0.4.6f13"
EXPECTED_EXPORTER_VERSION = "0.0.33"
SOURCES = {
    "barn": ("south-east", "3915f89ab3ea43791fdaabfb279021206756119cd51e5dc7eaf2705f41eb08f6"),
    "bungalow": ("south-east", "d266d7db3a0229fe0b108d45912c9b53fea9e0de08b47ca7e68e6a216033b22a"),
    "carwash": ("south-west", "19aa71b283f2c78e7484efa127b6ab6dd940ec3724c7a0ad68c0f85fbe92c1ad"),
    "dockswarehouse": ("south-east", "0a2c90c24fa3abe3ac0e4ca644aabcd89e6f7b559098efb0dee228f38d64e30b"),
    "laundromat": ("north-east", "c51a0de2365dfde544c77e0c63470a26a6603f420671e4f87c1f672e4f55c736"),
    "manor": ("south-east", "17f6db088754c9ebee1046fa6be6d8a8956a2a3d5a8d32497d15ab44e8a60387"),
    "motelroom": ("north-east", "4aa9fe6b0dda93be06b91bf96259c5b3ddb90e7d7b10791383bc900b4b80d453"),
    "postoffice": ("north-west", "dc449e93ac06fe95a21179801e01039c1b247f26928ec40c44b04a7d3345ed1f"),
    "rv": ("south-west", "41e027c7b5e7ffee86855641419e4574837c05a5d3f2463fd4aea6dc259e4ec9"),
    "seweroffice": ("south-east", "2a3c662f4b9128790c3f6f2572fb856817656ded763d32345519cd0960f7377e"),
    "storageunit": ("south-east", "fec280c09e8e21a81be692bddfa07b1861fa7f83370de819bc08c9106695eaea"),
    "sweatshop": ("south-east", "60c1f84e4d1e82368e995c82c448854889ba6aa02e130c6d58062f1854ebb9e5"),
    "tacoticklers": ("south-east", "c9cfa3d58b60103213df9f02b0bb7bb38e71a1a084f6d625c6f0983f0e4e697c"),
}
SOURCE_BLEND = 0.75
TARGET_BLEND = 0.25
EDGE_BLEND = 0.12
CANNY_LOW = 64
CANNY_HIGH = 160
OUTPUT_WIDTH = 960
OUTPUT_HEIGHT = 720
CANVAS_MARGIN = 48
CROP_PADDING_RATIO = 0.05
PNG_COMPRESSION = 9
TREATMENT_ID = "source-derived-property-grade-1"
REPLACE_ATTEMPTS = 20
REPLACE_RETRY_SECONDS = 0.1


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create deterministic public property derivatives from verified private captures."
    )
    parser.add_argument("--capture-directory", type=Path, required=True)
    parser.add_argument("--capture-response", type=Path, required=True)
    parser.add_argument("--output-directory", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--inspection-directory", type=Path)
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def image_facts(image: np.ndarray) -> dict[str, Any]:
    channels = 1 if image.ndim == 2 else image.shape[2]
    alpha_coverage = (
        float(np.count_nonzero(image[:, :, 3])) / float(image.shape[0] * image.shape[1])
        if channels == 4
        else 1.0
    )
    return {
        "dtype": str(image.dtype),
        "channels": channels,
        "alphaCoverage": round(alpha_coverage, 9),
    }


def apply_treatment(image: np.ndarray) -> np.ndarray:
    if image.ndim != 3 or image.shape[2] != 4:
        raise ValueError(f"Property source must be BGRA, found shape {image.shape}")
    color = image[:, :, :3]
    alpha = image[:, :, 3]
    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    luminance = gray.astype(np.float32) / 255.0
    low = np.array([31.0, 29.0, 35.0], dtype=np.float32)
    high = np.array([184.0, 201.0, 211.0], dtype=np.float32)
    target = low + luminance[:, :, None] * (high - low)
    graded = np.clip(
        color.astype(np.float32) * SOURCE_BLEND + target * TARGET_BLEND,
        0,
        255,
    ).astype(np.uint8)
    edges = cv2.Canny(cv2.GaussianBlur(gray, (3, 3), 0), CANNY_LOW, CANNY_HIGH)
    edges[alpha == 0] = 0
    edge_mask = edges.astype(np.float32)[:, :, None] / 255.0
    ink = np.array([20.0, 19.0, 24.0], dtype=np.float32)
    graded = np.clip(
        graded.astype(np.float32) * (1.0 - edge_mask * EDGE_BLEND)
        + ink * edge_mask * EDGE_BLEND,
        0,
        255,
    ).astype(np.uint8)
    graded[alpha == 0] = 0
    return np.dstack((graded, alpha))


def alpha_crop(image: np.ndarray) -> tuple[np.ndarray, list[int]]:
    points = cv2.findNonZero((image[:, :, 3] > 0).astype(np.uint8))
    if points is None:
        raise ValueError("Property source has no visible pixels")
    x, y, width, height = cv2.boundingRect(points)
    padding = max(8, round(max(width, height) * CROP_PADDING_RATIO))
    left = max(0, x - padding)
    top = max(0, y - padding)
    right = min(image.shape[1], x + width + padding)
    bottom = min(image.shape[0], y + height + padding)
    return image[top:bottom, left:right], [left, top, right - left, bottom - top]


def resize_premultiplied(image: np.ndarray, width: int, height: int) -> np.ndarray:
    alpha = image[:, :, 3].astype(np.float32) / 255.0
    premultiplied = image[:, :, :3].astype(np.float32) * alpha[:, :, None]
    interpolation = cv2.INTER_AREA if width < image.shape[1] or height < image.shape[0] else cv2.INTER_LANCZOS4
    resized_alpha = cv2.resize(alpha, (width, height), interpolation=interpolation)
    resized_premultiplied = cv2.resize(
        premultiplied, (width, height), interpolation=interpolation
    )
    color = np.zeros_like(resized_premultiplied, dtype=np.float32)
    visible = resized_alpha > (1.0 / 255.0)
    color[visible] = resized_premultiplied[visible] / resized_alpha[visible, None]
    return np.dstack(
        (
            np.clip(color, 0, 255).astype(np.uint8),
            np.clip(resized_alpha * 255.0, 0, 255).astype(np.uint8),
        )
    )


def fit_canvas(image: np.ndarray) -> np.ndarray:
    available_width = OUTPUT_WIDTH - CANVAS_MARGIN * 2
    available_height = OUTPUT_HEIGHT - CANVAS_MARGIN * 2
    scale = min(available_width / image.shape[1], available_height / image.shape[0])
    width = max(1, round(image.shape[1] * scale))
    height = max(1, round(image.shape[0] * scale))
    resized = resize_premultiplied(image, width, height)
    canvas = np.zeros((OUTPUT_HEIGHT, OUTPUT_WIDTH, 4), dtype=np.uint8)
    left = (OUTPUT_WIDTH - width) // 2
    top = (OUTPUT_HEIGHT - height) // 2
    canvas[top : top + height, left : left + width] = resized
    return canvas


def write_png(path: Path, image: np.ndarray) -> None:
    success, encoded = cv2.imencode(
        ".png", image, [cv2.IMWRITE_PNG_COMPRESSION, PNG_COMPRESSION]
    )
    if not success:
        raise RuntimeError(f"OpenCV could not encode {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(encoded.tobytes())
    replace_with_retry(temporary, path)


def replace_with_retry(temporary: Path, target: Path) -> None:
    for attempt in range(REPLACE_ATTEMPTS):
        try:
            temporary.replace(target)
            return
        except PermissionError:
            if attempt + 1 == REPLACE_ATTEMPTS:
                raise
            time.sleep(REPLACE_RETRY_SECONDS)


def process_asset(
    property_code: str,
    view: str,
    expected_sha256: str,
    capture_directory: Path,
    output_directory: Path,
) -> dict[str, Any]:
    source_path = capture_directory / f"{property_code}-{view}.png"
    source_sha256 = sha256_file(source_path)
    if source_sha256 != expected_sha256:
        raise ValueError(
            f"{property_code} source hash mismatch: expected {expected_sha256}, computed {source_sha256}"
        )
    source = cv2.imread(str(source_path), cv2.IMREAD_UNCHANGED)
    if source is None or source.shape != (960, 1280, 4) or source.dtype != np.uint8:
        raise ValueError(
            f"{property_code} source must be 1280x960 uint8 BGRA, found "
            f"{None if source is None else (source.shape, source.dtype)}"
        )
    treated = apply_treatment(source)
    cropped, crop_bounds = alpha_crop(treated)
    output = fit_canvas(cropped)
    output_path = output_directory / f"{property_code}.png"
    write_png(output_path, output)
    verified = cv2.imread(str(output_path), cv2.IMREAD_UNCHANGED)
    if verified is None or verified.shape != output.shape or verified.dtype != output.dtype:
        raise ValueError(f"{property_code} output verification failed")
    if not np.array_equal(verified, output):
        raise ValueError(f"{property_code} output pixels changed during PNG encoding")
    return {
        "propertyCode": property_code,
        "captureView": view,
        "path": f"assets/properties/{property_code}.png",
        "sourceSha256": source_sha256,
        "outputSha256": sha256_file(output_path),
        "width": OUTPUT_WIDTH,
        "height": OUTPUT_HEIGHT,
        "treatmentId": TREATMENT_ID,
        "source": image_facts(source),
        "output": image_facts(verified),
        "sourceCrop": {
            "left": crop_bounds[0],
            "top": crop_bounds[1],
            "width": crop_bounds[2],
            "height": crop_bounds[3],
        },
    }


def write_inspection_sheet(directory: Path, assets: list[dict[str, Any]], output_directory: Path) -> None:
    cell_width = 320
    cell_height = 260
    image_height = 240
    sheet = np.full((len(assets) * cell_height, cell_width, 3), 38, dtype=np.uint8)
    checker = np.indices((image_height, cell_width)).sum(axis=0) // 16 % 2
    background = np.where(checker[:, :, None] == 0, 66, 92).astype(np.uint8)
    background = np.repeat(background, 3, axis=2)
    for row, asset in enumerate(assets):
        image = cv2.imread(
            str(output_directory / f"{asset['propertyCode']}.png"), cv2.IMREAD_UNCHANGED
        )
        if image is None:
            raise ValueError(f"Could not reopen {asset['propertyCode']} for inspection")
        preview = cv2.resize(image, (cell_width, image_height), interpolation=cv2.INTER_AREA)
        alpha = preview[:, :, 3].astype(np.float32)[:, :, None] / 255.0
        composite = np.clip(
            preview[:, :, :3].astype(np.float32) * alpha
            + background.astype(np.float32) * (1.0 - alpha),
            0,
            255,
        ).astype(np.uint8)
        top = row * cell_height
        sheet[top : top + image_height] = composite
        cv2.putText(
            sheet,
            f"{asset['propertyCode']} / {asset['captureView']}",
            (6, top + image_height + 15),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.4,
            (235, 235, 235),
            1,
            cv2.LINE_AA,
        )
    directory.mkdir(parents=True, exist_ok=True)
    write_png(directory / "properties.png", sheet)


def validate_response(path: Path) -> dict[str, Any]:
    if sha256_file(path) != EXPECTED_RESPONSE_SHA256:
        raise ValueError("Capture response hash does not match the approved evidence run")
    response = json.loads(path.read_text(encoding="utf-8"))
    expected = {
        "schema": "neonschedule1-property-visual-capture-response-1",
        "gameVersion": EXPECTED_GAME_VERSION,
        "datasetSha256": EXPECTED_DATASET_SHA256,
        "exporterVersion": EXPECTED_EXPORTER_VERSION,
    }
    for key, value in expected.items():
        if response.get(key) != value:
            raise ValueError(f"Capture response {key} mismatch")
    captures = {
        (capture["propertyCode"], capture["view"]): capture
        for capture in response.get("captures", [])
    }
    for property_code, (view, source_sha256) in SOURCES.items():
        capture = captures.get((property_code, view))
        if capture is None or capture.get("sha256") != source_sha256:
            raise ValueError(f"Capture response is missing approved source {property_code}/{view}")
    return response


def main() -> None:
    arguments = parse_arguments()
    response = validate_response(arguments.capture_response)
    print(f"OpenCV {cv2.__version__}")
    assets = [
        process_asset(
            property_code,
            view,
            source_sha256,
            arguments.capture_directory,
            arguments.output_directory,
        )
        for property_code, (view, source_sha256) in SOURCES.items()
    ]
    if arguments.inspection_directory is not None:
        write_inspection_sheet(
            arguments.inspection_directory, assets, arguments.output_directory
        )
    provenance = {
        "schema": "neonschedule1-processed-property-provenance-1",
        "opencvVersion": cv2.__version__,
        "source": {
            "gameVersion": response["gameVersion"],
            "datasetSha256": response["datasetSha256"],
            "exporterVersion": response["exporterVersion"],
            "requestId": response["requestId"],
            "requestSha256": response["requestSha256"],
            "responseSha256": EXPECTED_RESPONSE_SHA256,
        },
        "operations": [
            "Load verified private capture PNGs with IMREAD_UNCHANGED.",
            "Blend 75 percent source color with a luminance-mapped project palette.",
            "Blend a low-opacity Canny edge accent inside the source alpha mask.",
            "Crop to the visible subject with proportional transparent padding.",
            "Resize premultiplied color and alpha onto a consistent transparent canvas.",
            "Encode a lossless PNG and verify every decoded output pixel.",
        ],
        "parameters": {
            "sourceBlend": SOURCE_BLEND,
            "targetBlend": TARGET_BLEND,
            "edgeBlend": EDGE_BLEND,
            "cannyLow": CANNY_LOW,
            "cannyHigh": CANNY_HIGH,
            "outputWidth": OUTPUT_WIDTH,
            "outputHeight": OUTPUT_HEIGHT,
            "canvasMargin": CANVAS_MARGIN,
            "cropPaddingRatio": CROP_PADDING_RATIO,
            "pngCompression": PNG_COMPRESSION,
        },
        "assets": assets,
    }
    arguments.provenance.parent.mkdir(parents=True, exist_ok=True)
    temporary = arguments.provenance.with_name(
        f".{arguments.provenance.name}.{os.getpid()}.tmp"
    )
    temporary.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    replace_with_retry(temporary, arguments.provenance)
    for asset in assets:
        print(
            f"{asset['propertyCode']}: {asset['width']}x{asset['height']}, "
            f"alpha {asset['output']['alphaCoverage']:.6f}, {asset['outputSha256']}"
        )


if __name__ == "__main__":
    main()
