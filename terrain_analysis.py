"""
terrain_analysis.py - Core hydrological terrain analysis.

Flow direction is calculated on the original DEM with a small
perturbation. This avoids flat-area problems and allows the upstream
catchment search to reach the actual local minima.

Main algorithms:
    - Priority-Flood depression filling
    - D8 flow direction
    - Flow accumulation
    - River detection using a flow-accumulation percentile
"""

import heapq
import logging

import numpy as np

from config import RIVER_PERCENTILE, DEM_PERTURB


log = logging.getLogger(__name__)


# D8 directions: N, NE, E, SE, S, SW, W, NW
D8 = [
    (-1, 0),
    (-1, 1),
    (0, 1),
    (1, 1),
    (1, 0),
    (1, -1),
    (0, -1),
    (-1, -1),
]

D8_DIST = [
    1.0,
    1.4142,
    1.0,
    1.4142,
    1.0,
    1.4142,
    1.0,
    1.4142,
]

NO_DIR = -1


def add_perturbation(
    dem: np.ndarray,
    seed: int = 42,
) -> np.ndarray:
    """Add small reproducible noise to avoid flat-area ambiguity."""

    rng = np.random.default_rng(seed)

    return dem + rng.uniform(
        0,
        DEM_PERTURB,
        dem.shape,
    )


def compute_flow_direction(
    dem: np.ndarray,
) -> np.ndarray:
    """
    Calculate D8 flow direction for each DEM cell.

    Returns an int8 array where 0-7 represent the D8 direction
    and NO_DIR (-1) represents a local minimum.
    """

    rows, cols = dem.shape

    fd = np.full(
        (rows, cols),
        NO_DIR,
        dtype=np.int8,
    )

    for r in range(rows):
        for c in range(cols):
            best_slope = 0.0
            best_d = NO_DIR

            for d, ((dr, dc), dist) in enumerate(
                zip(D8, D8_DIST)
            ):
                nr, nc = r + dr, c + dc

                if 0 <= nr < rows and 0 <= nc < cols:
                    slope = (
                        dem[r, c] - dem[nr, nc]
                    ) / dist

                    if slope > best_slope:
                        best_slope = slope
                        best_d = d

            fd[r, c] = best_d

    n_min = int(
        (fd == NO_DIR).sum()
    )

    log.info(
        "Flow direction done. Local minima: %d",
        n_min,
    )

    return fd


def compute_flow_accumulation(
    dem: np.ndarray,
    fd: np.ndarray,
) -> np.ndarray:
    """
    Calculate flow accumulation by processing cells from high
    elevation to low elevation.

    The returned values are normalized to the range [0, 1].
    """

    rows, cols = dem.shape

    acc = np.ones(
        (rows, cols),
        dtype=np.float64,
    )

    # Higher cells are processed first so their accumulated flow
    # can be passed to the cells below them.
    for flat_idx in np.argsort(-dem.ravel()):
        r, c = divmod(
            int(flat_idx),
            cols,
        )

        d = int(fd[r, c])

        if d == NO_DIR:
            continue

        dr, dc = D8[d]

        nr, nc = r + dr, c + dc

        if 0 <= nr < rows and 0 <= nc < cols:
            acc[nr, nc] += acc[r, c]

    log.info(
        "Flow accumulation done. Max: %.0f cells",
        acc.max(),
    )

    return acc / acc.max()


def fill_depressions(
    dem: np.ndarray,
) -> np.ndarray:
    """
    Fill depressions in the DEM using Priority-Flood.

    The returned DEM has the filled elevation values. The difference
    between the filled and original DEM gives the depression depth.
    """

    rows, cols = dem.shape

    filled = dem.copy().astype(np.float64)
    visited = np.zeros(
        (rows, cols),
        dtype=bool,
    )

    heap = []

    # Start the flood from the boundary cells.
    for r in range(rows):
        for c in (0, cols - 1):
            if not visited[r, c]:
                heapq.heappush(
                    heap,
                    (filled[r, c], r, c),
                )
                visited[r, c] = True

    for c in range(1, cols - 1):
        for r in (0, rows - 1):
            if not visited[r, c]:
                heapq.heappush(
                    heap,
                    (filled[r, c], r, c),
                )
                visited[r, c] = True

    while heap:
        elev, r, c = heapq.heappop(heap)

        for dr, dc in D8:
            nr, nc = r + dr, c + dc

            if (
                0 <= nr < rows
                and 0 <= nc < cols
                and not visited[nr, nc]
            ):
                visited[nr, nc] = True

                filled[nr, nc] = max(
                    dem[nr, nc],
                    elev,
                )

                heapq.heappush(
                    heap,
                    (filled[nr, nc], nr, nc),
                )

    n = int(
        (filled > dem + 1e-9).sum()
    )

    log.info(
        "Depression filling: %d cells raised",
        n,
    )

    return filled


def detect_rivers(
    acc_norm: np.ndarray,
    flow_dir: np.ndarray,
    pct: float = RIVER_PERCENTILE,
) -> np.ndarray:
    """
    Detect river or stream cells using the flow-accumulation threshold.

    Local minima are excluded because they are collection points rather
    than cells through which water continues to flow.
    """

    thr = float(
        np.percentile(
            acc_norm,
            pct,
        )
    )

    mask = (
        (acc_norm >= thr)
        & (flow_dir != NO_DIR)
    )

    log.info(
        "River mask: %d cells  (acc ≥ %.4f, p=%.0f, NO_DIR excluded)",
        int(mask.sum()),
        thr,
        pct,
    )

    return mask


def compute_slope_deg(
    dem: np.ndarray,
    cell_m: float = 30.0,
) -> np.ndarray:
    dz_dy, dz_dx = np.gradient(
        dem,
        cell_m,
        cell_m,
    )

    return np.degrees(
        np.arctan(
            np.sqrt(
                dz_dx**2 + dz_dy**2
            )
        )
    )