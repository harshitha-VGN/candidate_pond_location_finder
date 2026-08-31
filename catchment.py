"""
catchment.py - Pond candidate identification and catchment delineation.

The flow direction is calculated from the original DEM with a small
perturbation to avoid flat-area issues. Catchments are then found by
traversing the flow network in reverse from local minima.

Main steps:
    1. Find local minima from the flow-direction grid.
    2. Exclude river areas and unsuitable low-elevation points.
    3. Use reverse BFS to find the upstream catchment.
    4. Filter by catchment size and remove nearby duplicate candidates.
"""

import logging
from collections import deque

import numpy as np
from scipy.ndimage import label as scipy_label

from terrain_analysis import (
    D8,
    NO_DIR,
    add_perturbation,
    compute_flow_direction,
    fill_depressions,
    compute_slope_deg,
)

from config import (
    MIN_CATCHMENT_AREA_HA,
    MIN_CATCHMENT_CELLS,
    MAX_CATCHMENT_FRACTION,
    MIN_POND_DIST_CELLS,
    MIN_DEPRESSION_M,
    RIVER_SINK_FLOW_FRACTION,
    MIN_ELEVATION_PERCENTILE,
)


log = logging.getLogger(__name__)


def find_pond_candidates(
    dem: np.ndarray,
    flow_acc: np.ndarray,  # pre-computed on perturbed DEM
    river_mask: np.ndarray,
    grid_meta: dict,
    flow_dir: np.ndarray,  # computed on perturbed DEM (passed in from app)
) -> list[dict]:
    """
    Identify potential pond locations and delineate their catchments.
    """

    rows, cols = dem.shape
    cell_m2 = grid_meta["cell_area_m2"]
    avg_cell_m = (
        grid_meta["lon_res_m"] + grid_meta["lat_res_m"]
    ) / 2

    slope_deg = compute_slope_deg(
        dem,
        cell_m=avg_cell_m,
    )

    # Fill the DEM only for calculating how deep each depression is.
    filled_dem = fill_depressions(dem)
    depression_depth = filled_dem - dem

    # Check local minima and remove points that are likely to be part
    # of the river or low-lying floodplain.
    river_sink_mask = (
        (flow_dir == NO_DIR)
        & (flow_acc >= RIVER_SINK_FLOW_FRACTION)
    )

    n_sinks = int(river_sink_mask.sum())

    if n_sinks:
        log.info(
            "Excluded %d river-sink local minima "
            "(flow_acc >= %.2f)",
            n_sinks,
            RIVER_SINK_FLOW_FRACTION,
        )

    elev_floor = float(
        np.percentile(
            dem,
            MIN_ELEVATION_PERCENTILE,
        )
    )

    low_elev_mask = dem < elev_floor

    log.info(
        "Elevation floor: %.1f m (%.0f-th pct) — %d cells below",
        elev_floor,
        MIN_ELEVATION_PERCENTILE,
        int(low_elev_mask.sum()),
    )

    local_min = (
        (flow_dir == NO_DIR)
        & ~river_mask
        & ~river_sink_mask
        & ~low_elev_mask
    )

    # Boundary cells are not useful as pond candidates.
    local_min[[0, -1], :] = False
    local_min[:, [0, -1]] = False

    positions = np.argwhere(local_min)

    log.info(
        "Local minima found: %d (candidates before filtering)",
        len(positions),
    )

    # Convert the minimum area requirement into a number of grid cells.
    min_cells = max(
        MIN_CATCHMENT_CELLS,
        int(
            MIN_CATCHMENT_AREA_HA
            * 10_000
            / cell_m2
        ),
    )

    log.info(
        "Min catchment: %d cells (%.2f ha target, cell=%.0f m²)",
        min_cells,
        MIN_CATCHMENT_AREA_HA,
        cell_m2,
    )

    candidates = []

    for pos in positions:
        r, c = int(pos[0]), int(pos[1])

        # Start at the collection point and walk backwards through
        # the flow network to collect all upstream cells.
        catchment = _bfs_upstream(
            r,
            c,
            flow_dir,
            rows,
            cols,
        )

        n = len(catchment)

        if n < min_cells:
            continue

        if n > MAX_CATCHMENT_FRACTION * rows * cols:
            log.debug(
                "Skip (%d,%d): catchment too large (%d cells)",
                r,
                c,
                n,
            )
            continue

        c_rows = [rc[0] for rc in catchment]
        c_cols = [rc[1] for rc in catchment]

        c_elevs = dem[c_rows, c_cols]
        c_slopes = slope_deg[c_rows, c_cols]

        lon = float(
            np.array(grid_meta["grid_lons"])[
                min(c, cols - 1)
            ]
        )

        lat = float(
            np.array(grid_meta["grid_lats"])[
                min(r, rows - 1)
            ]
        )

        # These cells form the inner pond-site polygon.
        dep_cells = [
            (cr, cc)
            for cr, cc in catchment
            if depression_depth[cr, cc] >= MIN_DEPRESSION_M
        ]

        candidates.append({
            "row": r,
            "col": c,
            "lon": lon,
            "lat": lat,
            "elevation_m": float(dem[r, c]),
            "depression_depth_m": float(
                depression_depth[r, c]
            ),
            "flow_acc": float(flow_acc[r, c]),
            "slope_deg": float(slope_deg[r, c]),
            "is_river": False,
            "catchment_cells": catchment,
            "depression_cells": dep_cells,
            "catchment_area_m2": float(n * cell_m2),
            "catchment_area_ha": float(
                n * cell_m2 / 10_000
            ),
            "n_cells": n,
            "elev_min_m": float(c_elevs.min()),
            "elev_max_m": float(c_elevs.max()),
            "slope_mean_deg": float(c_slopes.mean()),
        })

    log.info(
        "After size filter: %d candidates",
        len(candidates),
    )

    # If no natural collection points pass the filters, try using
    # high-flow areas as a fallback.
    if not candidates:
        candidates = _fallback_high_acc(
            dem,
            flow_dir,
            flow_acc,
            river_mask,
            slope_deg,
            depression_depth,
            grid_meta,
            rows,
            cols,
            min_cells,
            cell_m2,
        )

    # Remove candidates that are too close to each other.
    candidates = _nms(
        candidates,
        MIN_POND_DIST_CELLS,
    )

    log.info(
        "After NMS: %d candidates",
        len(candidates),
    )

    return candidates


def _bfs_upstream(
    r0: int,
    c0: int,
    fd: np.ndarray,
    rows: int,
    cols: int,
) -> list:
    """
    Collect all cells that drain into (r0, c0) by walking the
    flow-direction grid in reverse.
    """

    visited = {(r0, c0)}
    queue = deque([(r0, c0)])

    while queue:
        r, c = queue.popleft()

        for dr, dc in D8:
            # Reverse the D8 offset to find possible upstream cells.
            nr, nc = r - dr, c - dc

            if not (0 <= nr < rows and 0 <= nc < cols):
                continue

            if (nr, nc) in visited:
                continue

            d = int(fd[nr, nc])

            if d == NO_DIR:
                continue

            fdr, fdc = D8[d]

            # Check whether this neighbouring cell actually flows
            # into the current cell.
            if (
                nr + fdr == r
                and nc + fdc == c
            ):
                visited.add((nr, nc))
                queue.append((nr, nc))

    return list(visited)


def _fallback_high_acc(
    dem,
    fd,
    acc,
    river_mask,
    slope_deg,
    dep_depth,
    meta,
    rows,
    cols,
    min_cells,
    cell_m2,
):
    log.warning(
        "No local-minima candidates — "
        "using high-accumulation fallback"
    )

    masked = acc.copy()

    masked[river_mask] = 0.0
    masked[[0, -1], :] = 0.0
    masked[:, [0, -1]] = 0.0

    candidates = []

    for flat_idx in np.argsort(-masked.ravel())[:60]:
        r, c = divmod(
            int(flat_idx),
            cols,
        )

        if masked[r, c] < 0.01:
            break

        ctch = _bfs_upstream(
            r,
            c,
            fd,
            rows,
            cols,
        )

        n = len(ctch)

        if (
            n < min_cells
            or n > MAX_CATCHMENT_FRACTION * rows * cols
        ):
            continue

        cr = [x[0] for x in ctch]
        cc = [x[1] for x in ctch]

        candidates.append({
            "row": r,
            "col": c,
            "lon": float(
                np.array(meta["grid_lons"])[
                    min(c, cols - 1)
                ]
            ),
            "lat": float(
                np.array(meta["grid_lats"])[
                    min(r, rows - 1)
                ]
            ),
            "elevation_m": float(dem[r, c]),
            "depression_depth_m": float(
                dep_depth[r, c]
            ),
            "flow_acc": float(acc[r, c]),
            "slope_deg": float(slope_deg[r, c]),
            "is_river": False,
            "catchment_cells": ctch,
            "catchment_area_m2": float(
                n * cell_m2
            ),
            "catchment_area_ha": float(
                n * cell_m2 / 10_000
            ),
            "n_cells": n,
            "elev_min_m": float(
                dem[cr, cc].min()
            ),
            "elev_max_m": float(
                dem[cr, cc].max()
            ),
            "slope_mean_deg": float(
                slope_deg[cr, cc].mean()
            ),
        })

    return candidates


def _nms(
    cands: list,
    min_dist: int,
) -> list:
    if not cands:
        return []

    cands = sorted(
        cands,
        key=lambda x: x["catchment_area_m2"],
        reverse=True,
    )

    keep = []
    sup = [False] * len(cands)

    for i, ci in enumerate(cands):
        if sup[i]:
            continue

        keep.append(ci)

        for j in range(i + 1, len(cands)):
            if sup[j]:
                continue

            dr = ci["row"] - cands[j]["row"]
            dc = ci["col"] - cands[j]["col"]

            if (dr * dr + dc * dc) ** 0.5 < min_dist:
                sup[j] = True

    return keep


def catchment_to_polygon(
    cells: list,
    meta: dict,
) -> list:
    """
    Convert grid-cell coordinates into a smooth exterior ring.

    Small clusters are skipped because they do not produce a useful
    polygon at this resolution.
    """

    if len(cells) < 20:
        return []

    res = meta["resolution"]

    mask = np.zeros(
        (res, res),
        dtype=np.float64,
    )

    for r, c in cells:
        if 0 <= r < res and 0 <= c < res:
            mask[r, c] = 1.0

    try:
        from skimage.measure import find_contours
        from scipy.ndimage import gaussian_filter as gblur

        # Smoothing the mask gives a less blocky watershed boundary.
        mask_smooth = gblur(
            mask,
            sigma=2.0,
        )

        contours = find_contours(
            mask_smooth,
            level=0.5,
        )

    except ImportError:
        return []

    if not contours:
        return []

    # The longest contour represents the outer boundary.
    outer = max(
        contours,
        key=len,
    )

    lons = np.array(meta["grid_lons"])
    lats = np.array(meta["grid_lats"])

    ring = []

    for y, x in outer:
        ri = int(
            np.clip(
                round(y),
                0,
                res - 1,
            )
        )

        ci = int(
            np.clip(
                round(x),
                0,
                res - 1,
            )
        )

        ring.append([
            float(lons[ci]),
            float(lats[ri]),
        ])

    # Remove repeated neighbouring points.
    deduped = [ring[0]]

    for pt in ring[1:]:
        if pt != deduped[-1]:
            deduped.append(pt)

    if (
        len(deduped) >= 4
        and deduped[0] != deduped[-1]
    ):
        deduped.append(deduped[0])

    return (
        deduped
        if len(deduped) >= 4
        else []
    )


def _bbox_poly(
    cells: list,
    meta: dict,
) -> list:
    lons = np.array(meta["grid_lons"])
    lats = np.array(meta["grid_lats"])

    rs = [r for r, _ in cells]
    cs = [c for _, c in cells]

    r0 = max(0, min(rs))
    r1 = min(
        len(lats) - 1,
        max(rs),
    )

    c0 = max(0, min(cs))
    c1 = min(
        len(lons) - 1,
        max(cs),
    )

    lon0 = float(lons[c0])
    lon1 = float(lons[c1])
    lat0 = float(lats[r0])
    lat1 = float(lats[r1])

    return [
        [lon0, lat0],
        [lon1, lat0],
        [lon1, lat1],
        [lon0, lat1],
        [lon0, lat0],
    ]