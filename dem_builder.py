"""
dem_builder.py - Build a DEM raster from contour polylines.

The contour points are interpolated onto a regular grid and then
lightly smoothed before being used by the terrain analysis.
"""

import logging

import numpy as np
from scipy.interpolate import griddata
from scipy.ndimage import gaussian_filter

GRID_RESOLUTION: int = 120
SAMPLE_SPACING_M: float = 20.0
SMOOTH_SIGMA: float = 1.5
INTERP_METHOD: str = "linear"


log = logging.getLogger(__name__)

_M_PER_DEG = 111_000.0   # Approximate metres per degree of latitude


def build_dem(
    contours: list[dict],
    resolution: int = GRID_RESOLUTION,
) -> tuple:
    """
    Returns:
        dem       : (resolution, resolution) float64 elevation array
        grid_meta : geographic information needed by later steps
    """

    lons, lats, elevs = _collect_points(contours)

    if len(lons) < 4:
        raise ValueError(
            f"Only {len(lons)} sample points — need ≥ 4 for interpolation."
        )

    lon_min, lon_max = lons.min(), lons.max()
    lat_min, lat_max = lats.min(), lats.max()

    # Small padding keeps the generated grid from ending exactly on
    # the outermost contour points.
    pad_lon = max((lon_max - lon_min) * 0.01, 1e-5)
    pad_lat = max((lat_max - lat_min) * 0.01, 1e-5)

    lon_min -= pad_lon
    lon_max += pad_lon
    lat_min -= pad_lat
    lat_max += pad_lat

    grid_lons = np.linspace(lon_min, lon_max, resolution)
    grid_lats = np.linspace(lat_min, lat_max, resolution)

    glon, glat = np.meshgrid(grid_lons, grid_lats)

    log.info(
        "Interpolating %d pts → %dx%d grid (method=%s)",
        len(lons),
        resolution,
        resolution,
        INTERP_METHOD,
    )

    dem = griddata(
        np.column_stack([lons, lats]),
        elevs,
        (glon, glat),
        method=INTERP_METHOD,
    )

    # Linear interpolation can leave gaps outside the convex hull.
    # Nearest-neighbour fills only those missing cells.
    nan_mask = np.isnan(dem)

    if nan_mask.any():
        nearest = griddata(
            np.column_stack([lons, lats]),
            elevs,
            (glon, glat),
            method="nearest",
        )
        dem[nan_mask] = nearest[nan_mask]

    dem = gaussian_filter(
        dem.astype(np.float64),
        sigma=SMOOTH_SIGMA,
    )

    clat = (lat_min + lat_max) / 2

    lon_res_m = (
        (lon_max - lon_min) / resolution
        * _M_PER_DEG
        * np.cos(np.radians(clat))
    )

    lat_res_m = (
        (lat_max - lat_min)
        / resolution
        * _M_PER_DEG
    )

    cell_m2 = lon_res_m * lat_res_m

    meta = {
        "lon_min": float(lon_min),
        "lon_max": float(lon_max),
        "lat_min": float(lat_min),
        "lat_max": float(lat_max),
        "resolution": resolution,
        "grid_lons": grid_lons.tolist(),
        "grid_lats": grid_lats.tolist(),
        "lon_res_m": float(lon_res_m),
        "lat_res_m": float(lat_res_m),
        "cell_area_m2": float(cell_m2),
        "center_lat": float(clat),
        "elev_min": float(elevs.min()),
        "elev_max": float(elevs.max()),
        "n_contours": len(contours),
        "n_pts": int(len(lons)),
    }

    log.info(
        "DEM %dx%d  elev %.1f–%.1f m  cell %.1f×%.1f m",
        resolution,
        resolution,
        elevs.min(),
        elevs.max(),
        lon_res_m,
        lat_res_m,
    )

    return dem, meta


def _collect_points(contours):
    lons, lats, elevs = [], [], []

    for c in contours:
        for lon, lat in _sample(
            c["coordinates"],
            SAMPLE_SPACING_M,
        ):
            lons.append(lon)
            lats.append(lat)
            elevs.append(c["elevation"])

    return (
        np.array(lons),
        np.array(lats),
        np.array(elevs),
    )


def _sample(coords: list, spacing_m: float) -> list:
    if len(coords) <= 1:
        return list(coords)

    spacing_deg = spacing_m / _M_PER_DEG

    out = [coords[0]]
    rem = 0.0

    for i in range(1, len(coords)):
        p0 = np.array(coords[i - 1])
        p1 = np.array(coords[i])

        seg = float(np.linalg.norm(p1 - p0))

        if seg < 1e-12:
            continue

        d = (p1 - p0) / seg
        pos = rem

        while pos < seg:
            pt = p0 + d * pos
            out.append((float(pt[0]), float(pt[1])))
            pos += spacing_deg

        rem = pos - seg

    if out[-1] != coords[-1]:
        out.append(coords[-1])

    return out