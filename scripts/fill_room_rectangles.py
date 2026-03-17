#!/usr/bin/env python3
"""
Progressive room cleanup by filling furniture/noise with axis-aligned rectangles.

Approach:
1) Build a conservative wall/obstacle stop-mask from thick dark structures.
2) Build a room-like mask from local floor color near a seed point.
3) Keep only the connected component containing the seed.
4) Grow one (or many) rectangles inside that component and paint them.
"""

from __future__ import annotations

import argparse
import dataclasses
from pathlib import Path
from typing import List, Optional, Tuple

import cv2
import numpy as np


@dataclasses.dataclass
class Rect:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def area(self) -> int:
        return (self.right - self.left + 1) * (self.bottom - self.top + 1)


def smart_left_expand(
    gray: np.ndarray,
    rect: Rect,
    dark_threshold: int = 70,
    top_ignore_px: int = 150,
    overall_dark_limit: float = 0.06,
    core_dark_limit: float = 0.03,
    hard_col_fraction: float = 0.8,
    max_extra_cols: int = 200,
) -> Rect:
    """
    Expand rectangle leftward while tolerating narrow door/jamb spikes.

    Uses strip-level criteria instead of single-column stop:
    - low overall dark-pixel ratio in the added strip
    - low dark ratio in the lower "core" rows (door artifacts are usually upper)
    - no near-full-height dark columns (hard wall signal)
    """
    h = rect.bottom - rect.top + 1
    if h <= 0:
        return rect

    core_top = min(rect.bottom, rect.top + max(0, int(top_ignore_px)))
    best_left = rect.left
    min_x = max(0, rect.left - max(0, int(max_extra_cols)))

    for cand_left in range(rect.left - 1, min_x - 1, -1):
        strip = gray[rect.top : rect.bottom + 1, cand_left : rect.left]
        if strip.size == 0:
            continue

        dark = strip < dark_threshold
        overall_ratio = float(dark.mean())

        core_strip = gray[core_top : rect.bottom + 1, cand_left : rect.left]
        if core_strip.size == 0:
            core_ratio = 0.0
        else:
            core_ratio = float((core_strip < dark_threshold).mean())

        col_dark_counts = dark.sum(axis=0)
        hard_cols = int(np.sum(col_dark_counts >= hard_col_fraction * h))

        allowed = (
            overall_ratio <= overall_dark_limit
            and core_ratio <= core_dark_limit
            and hard_cols == 0
        )
        if allowed:
            best_left = cand_left
            continue

        # Once a hard wall column appears, further left is unlikely to recover.
        if hard_cols > 0:
            break

    return Rect(
        left=best_left,
        top=rect.top,
        right=rect.right,
        bottom=rect.bottom,
    )


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def connected_component_from_seed(
    mask: np.ndarray, seed_xy: Tuple[int, int]
) -> np.ndarray:
    h, w = mask.shape
    sx, sy = seed_xy
    if sx < 0 or sx >= w or sy < 0 or sy >= h:
        raise ValueError(f"Seed ({sx}, {sy}) is out of image bounds {w}x{h}.")

    allowed = (mask > 0).astype(np.uint8)
    if allowed[sy, sx] == 0:
        raise ValueError(
            "Seed is not in a valid candidate region. "
            "Try a nearby point in open room floor."
        )

    labels_count, labels = cv2.connectedComponents(allowed, connectivity=8)
    seed_label = labels[sy, sx]
    if seed_label <= 0 or seed_label >= labels_count:
        raise ValueError("Could not resolve a connected component for the seed.")
    return (labels == seed_label).astype(np.uint8)


def keep_large_components(mask: np.ndarray, min_area: int) -> np.ndarray:
    labels_count, labels, stats, _ = cv2.connectedComponentsWithStats(
        mask, connectivity=8
    )
    out = np.zeros_like(mask, dtype=np.uint8)
    for label_idx in range(1, labels_count):
        area = int(stats[label_idx, cv2.CC_STAT_AREA])
        if area >= min_area:
            out[labels == label_idx] = 1
    return out


def keep_border_connected_components(mask: np.ndarray) -> np.ndarray:
    labels_count, labels = cv2.connectedComponents(mask, connectivity=8)
    if labels_count <= 1:
        return np.zeros_like(mask, dtype=np.uint8)

    border_labels = set(labels[0, :].tolist())
    border_labels.update(labels[-1, :].tolist())
    border_labels.update(labels[:, 0].tolist())
    border_labels.update(labels[:, -1].tolist())
    border_labels.discard(0)

    out = np.zeros_like(mask, dtype=np.uint8)
    for label in border_labels:
        out[labels == label] = 1
    return out


def make_stop_mask(
    bgr: np.ndarray,
    dark_threshold: int,
    min_wall_component: int,
    close_kernel: int,
    margin: int,
    border_connected_only: bool,
) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    dark = (gray < dark_threshold).astype(np.uint8)

    # Remove thin text/furniture strokes; keep only thick dark structures.
    opened = cv2.morphologyEx(
        dark,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5)),
    )
    thick = keep_large_components(opened, min_area=min_wall_component)

    if border_connected_only:
        # In these plans, true walls and exterior dark regions usually connect
        # to the boundary graph; furniture and text are often interior islands.
        thick = keep_border_connected_components(thick)

    # Close local gaps so door openings behave more like room boundaries.
    if close_kernel > 1:
        k = cv2.getStructuringElement(cv2.MORPH_RECT, (close_kernel, close_kernel))
        thick = cv2.morphologyEx(thick, cv2.MORPH_CLOSE, k)

    if margin > 0:
        k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (margin * 2 + 1, margin * 2 + 1)
        )
        thick = cv2.dilate(thick, k, iterations=1)

    return (thick > 0).astype(np.uint8)


def make_floor_similarity_mask(
    bgr: np.ndarray,
    seed_xy: Tuple[int, int],
    color_tol: float,
    seed_patch_radius: int,
) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    h, w = lab.shape[:2]
    sx, sy = seed_xy
    x0 = clamp(sx - seed_patch_radius, 0, w - 1)
    x1 = clamp(sx + seed_patch_radius, 0, w - 1)
    y0 = clamp(sy - seed_patch_radius, 0, h - 1)
    y1 = clamp(sy + seed_patch_radius, 0, h - 1)
    patch = lab[y0 : y1 + 1, x0 : x1 + 1]
    mean_lab = patch.reshape(-1, 3).mean(axis=0)
    delta = np.linalg.norm(lab - mean_lab[None, None, :], axis=2)
    return (delta <= color_tol).astype(np.uint8)


def grow_rectangle_in_mask(
    mask: np.ndarray, seed_xy: Tuple[int, int]
) -> Optional[Rect]:
    return largest_rectangle_containing_seed(mask, seed_xy)


def largest_rectangle_containing_seed(
    mask: np.ndarray, seed_xy: Tuple[int, int]
) -> Optional[Rect]:
    h, w = mask.shape
    sx, sy = seed_xy
    if mask[sy, sx] == 0:
        return None

    heights = np.zeros(w, dtype=np.int32)
    best: Optional[Rect] = None
    best_area = 0

    for y in range(h):
        row = mask[y] > 0
        heights = np.where(row, heights + 1, 0)

        stack: List[Tuple[int, int]] = []
        for x in range(w + 1):
            cur_h = int(heights[x]) if x < w else 0
            start = x
            while stack and stack[-1][1] > cur_h:
                idx, hgt = stack.pop()
                if hgt <= 0:
                    start = idx
                    continue

                left = idx
                right = x - 1
                top = y - hgt + 1
                bottom = y

                if top <= sy <= bottom and left <= sx <= right:
                    area = hgt * (right - left + 1)
                    if area > best_area:
                        best_area = area
                        best = Rect(left=left, top=top, right=right, bottom=bottom)
                start = idx
            if not stack or stack[-1][1] < cur_h:
                stack.append((start, cur_h))

    return best


def pick_next_seed(mask: np.ndarray) -> Optional[Tuple[int, int]]:
    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None
    return int(xs[0]), int(ys[0])


def parse_fill_color(fill: str) -> Tuple[int, int, int]:
    value = fill.strip().lower()
    if value == "white":
        return (255, 255, 255)
    parts = [p.strip() for p in value.split(",")]
    if len(parts) != 3:
        raise ValueError("Fill color must be 'white' or 'R,G,B'.")
    rgb = tuple(int(p) for p in parts)
    if any(c < 0 or c > 255 for c in rgb):
        raise ValueError("Fill color channels must be in [0, 255].")
    return rgb  # type: ignore[return-value]


def nearest_foreground(
    mask: np.ndarray, seed_xy: Tuple[int, int], max_radius: int
) -> Optional[Tuple[int, int]]:
    sx, sy = seed_xy
    if mask[sy, sx] > 0:
        return seed_xy

    ys, xs = np.where(mask > 0)
    if len(xs) == 0:
        return None

    d2 = (xs - sx) * (xs - sx) + (ys - sy) * (ys - sy)
    idx = int(np.argmin(d2))
    if int(d2[idx]) > max_radius * max_radius:
        return None
    return int(xs[idx]), int(ys[idx])


def progressive_fill(
    bgr: np.ndarray,
    room_mask: np.ndarray,
    initial_seed: Tuple[int, int],
    max_rects: int,
    min_rect_area: int,
) -> List[Rect]:
    remaining = room_mask.copy().astype(np.uint8)
    rectangles: List[Rect] = []

    seed = initial_seed
    for _ in range(max_rects):
        if remaining[seed[1], seed[0]] == 0:
            new_seed = pick_next_seed(remaining)
            if new_seed is None:
                break
            seed = new_seed

        rect = grow_rectangle_in_mask(remaining, seed)
        if rect is None:
            break
        if rect.area < min_rect_area:
            # Mark this seed as used and continue searching.
            remaining[seed[1], seed[0]] = 0
            continue

        rectangles.append(rect)
        remaining[rect.top : rect.bottom + 1, rect.left : rect.right + 1] = 0

        new_seed = pick_next_seed(remaining)
        if new_seed is None:
            break
        seed = new_seed

    return rectangles


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fill a room region with one or more grown rectangles from a seed point."
    )
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output", required=True, help="Output image path.")
    parser.add_argument(
        "--seed-x", required=True, type=int, help="Room seed X coordinate."
    )
    parser.add_argument(
        "--seed-y", required=True, type=int, help="Room seed Y coordinate."
    )
    parser.add_argument(
        "--color-tol",
        type=float,
        default=22.0,
        help="Lab color distance threshold for room-floor similarity (default: 22.0).",
    )
    parser.add_argument(
        "--dark-threshold",
        type=int,
        default=100,
        help="Dark-pixel threshold for obstacle extraction (default: 100).",
    )
    parser.add_argument(
        "--min-wall-component",
        type=int,
        default=1200,
        help="Minimum area for thick dark components to act as walls (default: 1200).",
    )
    parser.add_argument(
        "--close-kernel",
        type=int,
        default=11,
        help="Kernel size for closing gaps in wall mask (default: 11).",
    )
    parser.add_argument(
        "--wall-margin",
        type=int,
        default=4,
        help="Dilation margin around obstacle mask in pixels (default: 4).",
    )
    parser.add_argument(
        "--border-connected-stop",
        action="store_true",
        default=True,
        help=(
            "Use only border-connected thick dark components as stop-mask. "
            "Enabled by default."
        ),
    )
    parser.add_argument(
        "--no-border-connected-stop",
        action="store_false",
        dest="border_connected_stop",
        help="Disable border-connected filtering for stop-mask.",
    )
    parser.add_argument(
        "--max-rects",
        type=int,
        default=1,
        help="Maximum number of rectangles to grow and fill (default: 1).",
    )
    parser.add_argument(
        "--min-rect-area",
        type=int,
        default=800,
        help="Ignore rectangles smaller than this area (default: 800).",
    )
    parser.add_argument(
        "--seed-patch-radius",
        type=int,
        default=4,
        help="Radius around seed used for floor color estimate (default: 4).",
    )
    parser.add_argument(
        "--candidate-mode",
        choices=["floor-stop", "stop-only"],
        default="floor-stop",
        help=(
            "Mask source for room component: "
            "'floor-stop' = floor similarity intersected with stop-mask inverse, "
            "'stop-only' = stop-mask inverse only."
        ),
    )
    parser.add_argument(
        "--limit-radius",
        type=int,
        default=0,
        help=(
            "Optional pixel radius around seed to constrain room candidate "
            "(0 disables, default: 0)."
        ),
    )
    parser.add_argument(
        "--fill-color",
        default="white",
        help="Fill color: 'white' or 'R,G,B' (default: white).",
    )
    parser.add_argument(
        "--room-close-kernel",
        type=int,
        default=19,
        help="Kernel size for closing furniture/text holes inside room mask (default: 19).",
    )
    parser.add_argument(
        "--room-open-kernel",
        type=int,
        default=5,
        help="Kernel size for opening tiny speckles in room mask (default: 5).",
    )
    parser.add_argument(
        "--split-kernel",
        type=int,
        default=21,
        help=(
            "Kernel size for seed-room isolation via erode+dilate. "
            "Higher values separate rooms more aggressively (default: 21)."
        ),
    )
    parser.add_argument(
        "--debug-mask-output",
        default="",
        help="Optional output path for visual debug mask PNG.",
    )
    parser.add_argument(
        "--smart-left-expand",
        action="store_true",
        help=(
            "Post-process a single rectangle with strip-level left expansion that "
            "can pass door/jamb spikes but stops at hard walls."
        ),
    )
    parser.add_argument(
        "--smart-left-dark-threshold",
        type=int,
        default=70,
        help="Dark threshold for smart left expansion (default: 70).",
    )
    parser.add_argument(
        "--smart-left-top-ignore",
        type=int,
        default=150,
        help="Top rows to de-emphasize during smart left expansion (default: 150).",
    )
    parser.add_argument(
        "--smart-left-overall-limit",
        type=float,
        default=0.06,
        help="Max overall dark ratio in added strip for smart left expansion (default: 0.06).",
    )
    parser.add_argument(
        "--smart-left-core-limit",
        type=float,
        default=0.03,
        help="Max lower-core dark ratio in added strip for smart left expansion (default: 0.03).",
    )
    parser.add_argument(
        "--smart-left-hard-col-frac",
        type=float,
        default=0.8,
        help=(
            "Column dark fraction considered hard wall during smart left expansion "
            "(default: 0.8)."
        ),
    )
    parser.add_argument(
        "--smart-left-max-extra",
        type=int,
        default=200,
        help="Max pixels to expand left during smart left expansion (default: 200).",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    if not input_path.exists():
        raise FileNotFoundError(f"Input image does not exist: {input_path}")

    bgr = cv2.imread(str(input_path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Could not read image: {input_path}")
    h, w = bgr.shape[:2]

    seed = (args.seed_x, args.seed_y)
    if not (0 <= seed[0] < w and 0 <= seed[1] < h):
        raise ValueError(f"Seed {seed} is outside image bounds {w}x{h}.")

    stop_mask = make_stop_mask(
        bgr=bgr,
        dark_threshold=args.dark_threshold,
        min_wall_component=args.min_wall_component,
        close_kernel=args.close_kernel,
        margin=args.wall_margin,
        border_connected_only=bool(args.border_connected_stop),
    )
    floor_mask = make_floor_similarity_mask(
        bgr=bgr,
        seed_xy=seed,
        color_tol=args.color_tol,
        seed_patch_radius=args.seed_patch_radius,
    )

    if args.candidate_mode == "stop-only":
        candidate = stop_mask == 0
    else:
        candidate = (floor_mask > 0) & (stop_mask == 0)

    if args.limit_radius and args.limit_radius > 0:
        yy, xx = np.ogrid[:h, :w]
        rr2 = (xx - seed[0]) * (xx - seed[0]) + (yy - seed[1]) * (yy - seed[1])
        candidate = candidate & (rr2 <= int(args.limit_radius) * int(args.limit_radius))

    room_mask = connected_component_from_seed(candidate.astype(np.uint8), seed)

    # Smooth away interior furniture/text gaps without crossing hard boundaries.
    if args.room_close_kernel > 1:
        k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (args.room_close_kernel, args.room_close_kernel)
        )
        room_mask = cv2.morphologyEx(room_mask, cv2.MORPH_CLOSE, k)
    if args.room_open_kernel > 1:
        k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (args.room_open_kernel, args.room_open_kernel)
        )
        room_mask = cv2.morphologyEx(room_mask, cv2.MORPH_OPEN, k)

    room_mask = (room_mask > 0).astype(np.uint8)
    room_mask[stop_mask > 0] = 0
    room_mask = connected_component_from_seed(room_mask, seed)

    # Split through narrow door-neck connections to keep only the target room.
    if args.split_kernel > 1:
        k = cv2.getStructuringElement(
            cv2.MORPH_ELLIPSE, (args.split_kernel, args.split_kernel)
        )
        eroded = cv2.erode(room_mask, k, iterations=1)
        split_seed = nearest_foreground(
            eroded,
            seed_xy=seed,
            max_radius=max(30, int(args.split_kernel) * 3),
        )
        if split_seed is not None:
            core = connected_component_from_seed(eroded, split_seed)
            expanded = cv2.dilate(core, k, iterations=1)
            room_mask = ((expanded > 0) & (room_mask > 0)).astype(np.uint8)

    rectangles = progressive_fill(
        bgr=bgr,
        room_mask=room_mask,
        initial_seed=seed,
        max_rects=max(1, int(args.max_rects)),
        min_rect_area=max(1, int(args.min_rect_area)),
    )

    if not rectangles:
        raise RuntimeError(
            "No rectangle was grown. Try increasing color tolerance or changing seed."
        )

    if args.smart_left_expand and len(rectangles) == 1:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        rectangles[0] = smart_left_expand(
            gray=gray,
            rect=rectangles[0],
            dark_threshold=int(args.smart_left_dark_threshold),
            top_ignore_px=int(args.smart_left_top_ignore),
            overall_dark_limit=float(args.smart_left_overall_limit),
            core_dark_limit=float(args.smart_left_core_limit),
            hard_col_fraction=float(args.smart_left_hard_col_frac),
            max_extra_cols=int(args.smart_left_max_extra),
        )

    fill_rgb = parse_fill_color(args.fill_color)
    out = bgr.copy()
    fill_bgr = (fill_rgb[2], fill_rgb[1], fill_rgb[0])
    for rect in rectangles:
        out[rect.top : rect.bottom + 1, rect.left : rect.right + 1] = fill_bgr

    output_path.parent.mkdir(parents=True, exist_ok=True)
    ok = cv2.imwrite(str(output_path), out)
    if not ok:
        raise RuntimeError(f"Could not write output image: {output_path}")

    if args.debug_mask_output:
        debug = np.zeros((h, w, 3), dtype=np.uint8)
        debug[room_mask > 0] = (90, 170, 255)  # room candidate (blue-ish)
        debug[stop_mask > 0] = (0, 0, 255)  # obstacle/wall stop (red)
        for rect in rectangles:
            cv2.rectangle(
                debug, (rect.left, rect.top), (rect.right, rect.bottom), (0, 255, 0), 2
            )
        cv2.circle(debug, seed, 5, (255, 255, 0), -1)
        debug_out = Path(args.debug_mask_output)
        debug_out.parent.mkdir(parents=True, exist_ok=True)
        ok = cv2.imwrite(str(debug_out), debug)
        if not ok:
            raise RuntimeError(f"Could not write debug mask image: {debug_out}")

    print(f"Input: {input_path}")
    print(f"Output: {output_path}")
    print(f"Seed: {seed}")
    print(f"Rectangles: {len(rectangles)}")
    for i, rect in enumerate(rectangles, start=1):
        print(
            f"  {i}: left={rect.left} top={rect.top} "
            f"right={rect.right} bottom={rect.bottom} area={rect.area}"
        )


if __name__ == "__main__":
    main()
