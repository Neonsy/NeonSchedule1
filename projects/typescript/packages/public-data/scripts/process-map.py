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
from typing import Any

import cv2
import numpy as np


EXPECTED_SOURCES = {
    "hyland-point": "98fc63f5528f07a5ae651a9efa2cb6f443c1dc7c4059966d50413618275de7b9",
    "tutorial-area": "77378de150d94077d3f35add1575a2eee0b751fde7946ffe6216373b788d0f9a",
}
OUTPUT_NAMES = {
    "hyland-point": "hyland-point.png",
    "tutorial-area": "tutorial-area.png",
}
SOURCE_BLEND = 0.75
TARGET_BLEND = 0.25
EDGE_BLEND = 0.12
CANNY_LOW = 64
CANNY_HIGH = 160
PNG_COMPRESSION = 9
TREATMENT_ID = "source-derived-map-grade-1"


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create deterministic, replaceable source-derived Schedule I map inputs."
    )
    parser.add_argument("--main-source", type=Path, required=True)
    parser.add_argument("--tutorial-source", type=Path, required=True)
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
    if channels == 4:
        alpha_coverage = float(np.count_nonzero(image[:, :, 3])) / float(
            image.shape[0] * image.shape[1]
        )
    else:
        alpha_coverage = 1.0
    return {
        "dtype": str(image.dtype),
        "channels": channels,
        "alphaCoverage": round(alpha_coverage, 9),
    }


def split_color_and_alpha(image: np.ndarray) -> tuple[np.ndarray, np.ndarray | None]:
    if image.ndim == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR), None
    if image.shape[2] == 3:
        return image, None
    if image.shape[2] == 4:
        return image[:, :, :3], image[:, :, 3]
    raise ValueError(f"Unsupported channel count: {image.shape[2]}")


def apply_treatment(image: np.ndarray) -> np.ndarray:
    color, alpha = split_color_and_alpha(image)
    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY).astype(np.float32) / 255.0
    low = np.array([31.0, 29.0, 35.0], dtype=np.float32)
    high = np.array([184.0, 201.0, 211.0], dtype=np.float32)
    target = low + gray[:, :, None] * (high - low)
    graded = np.clip(
        color.astype(np.float32) * SOURCE_BLEND + target * TARGET_BLEND,
        0,
        255,
    ).astype(np.uint8)
    edges = cv2.Canny(cv2.GaussianBlur(gray * 255.0, (3, 3), 0).astype(np.uint8), CANNY_LOW, CANNY_HIGH)
    edge_mask = edges.astype(np.float32)[:, :, None] / 255.0
    ink = np.array([20.0, 19.0, 24.0], dtype=np.float32)
    graded = np.clip(
        graded.astype(np.float32) * (1.0 - edge_mask * EDGE_BLEND)
        + ink * edge_mask * EDGE_BLEND,
        0,
        255,
    ).astype(np.uint8)
    if alpha is None:
        return graded
    return np.dstack((graded, alpha))


def write_png(path: Path, image: np.ndarray) -> None:
    success, encoded = cv2.imencode(
        ".png",
        image,
        [cv2.IMWRITE_PNG_COMPRESSION, PNG_COMPRESSION],
    )
    if not success:
        raise RuntimeError(f"OpenCV could not encode {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(encoded.tobytes())
    temporary.replace(path)


def write_inspection_images(directory: Path, map_id: str, image: np.ndarray) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    preview = cv2.resize(image, (1024, 1024), interpolation=cv2.INTER_AREA)
    height, width = image.shape[:2]
    crop_size = min(1024, height, width)
    left = (width - crop_size) // 2
    top = (height - crop_size) // 2
    crop = image[top : top + crop_size, left : left + crop_size]
    write_png(directory / f"{map_id}-preview.png", preview)
    write_png(directory / f"{map_id}-center.png", crop)


def process_asset(map_id: str, source_path: Path, output_directory: Path) -> dict[str, Any]:
    source_sha256 = sha256_file(source_path)
    if source_sha256 != EXPECTED_SOURCES[map_id]:
        raise ValueError(
            f"{map_id} source hash mismatch: expected {EXPECTED_SOURCES[map_id]}, "
            f"computed {source_sha256}"
        )
    source = cv2.imread(str(source_path), cv2.IMREAD_UNCHANGED)
    if source is None:
        raise ValueError(f"OpenCV could not read {source_path}")
    if source.shape[0] != 4096 or source.shape[1] != 4096:
        raise ValueError(f"{map_id} source must be 4096x4096, found {source.shape[1]}x{source.shape[0]}")
    output = apply_treatment(source)
    if output.shape != source.shape:
        raise ValueError(f"{map_id} treatment changed the image shape")
    output_path = output_directory / OUTPUT_NAMES[map_id]
    write_png(output_path, output)
    verified = cv2.imread(str(output_path), cv2.IMREAD_UNCHANGED)
    if verified is None or verified.shape != output.shape or verified.dtype != output.dtype:
        raise ValueError(f"{map_id} output verification failed")
    if not np.array_equal(verified, output):
        raise ValueError(f"{map_id} output pixels changed during PNG encoding")
    return {
        "mapId": map_id,
        "path": f"assets/map/{OUTPUT_NAMES[map_id]}",
        "sourceSha256": source_sha256,
        "outputSha256": sha256_file(output_path),
        "width": int(output.shape[1]),
        "height": int(output.shape[0]),
        "treatmentId": TREATMENT_ID,
        "source": image_facts(source),
        "output": image_facts(verified),
    }


def main() -> None:
    arguments = parse_arguments()
    print(f"OpenCV {cv2.__version__}")
    assets = [
        process_asset("hyland-point", arguments.main_source, arguments.output_directory),
        process_asset("tutorial-area", arguments.tutorial_source, arguments.output_directory),
    ]
    if arguments.inspection_directory is not None:
        for asset in assets:
            output = cv2.imread(
                str(arguments.output_directory / OUTPUT_NAMES[asset["mapId"]]),
                cv2.IMREAD_UNCHANGED,
            )
            if output is None:
                raise ValueError(f"Could not reopen {asset['mapId']} for inspection")
            write_inspection_images(arguments.inspection_directory, asset["mapId"], output)
    provenance = {
        "schema": "neonschedule1-processed-map-provenance-1",
        "opencvVersion": cv2.__version__,
        "operations": [
            "Load with IMREAD_UNCHANGED and preserve the source alpha channel.",
            "Blend 75 percent source color with a luminance-mapped project palette.",
            "Blend a low-opacity Canny edge accent into detected boundaries.",
            "Encode a lossless PNG and verify every decoded output pixel.",
        ],
        "parameters": {
            "sourceBlend": SOURCE_BLEND,
            "targetBlend": TARGET_BLEND,
            "edgeBlend": EDGE_BLEND,
            "cannyLow": CANNY_LOW,
            "cannyHigh": CANNY_HIGH,
            "pngCompression": PNG_COMPRESSION,
        },
        "assets": assets,
    }
    arguments.provenance.parent.mkdir(parents=True, exist_ok=True)
    temporary = arguments.provenance.with_name(
        f".{arguments.provenance.name}.{os.getpid()}.tmp"
    )
    temporary.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.replace(arguments.provenance)
    for asset in assets:
        print(
            f"{asset['mapId']}: {asset['width']}x{asset['height']}, "
            f"{asset['source']['channels']} source channels, "
            f"{asset['output']['channels']} output channels, {asset['outputSha256']}"
        )


if __name__ == "__main__":
    main()
