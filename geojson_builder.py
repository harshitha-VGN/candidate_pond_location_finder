"""
geojson_builder.py - Build the GeoJSON output.

Each selected candidate produces:
    1. The complete upstream catchment polygon
    2. The inner pond-site/depression polygon
    3. A point marking the exact candidate location
"""

import logging

import numpy as np

from catchment import catchment_to_polygon


log = logging.getLogger(__name__)


def build_geojson(
    top: list,
    dem: np.ndarray,
    meta: dict,
    contours: list,
) -> dict:
    features = []

    for c in top:
        # Outer polygon: complete upstream catchment.
        catchment_cells = c.get("catchment_cells", [])
        catch_ring = catchment_to_polygon(
            catchment_cells,
            meta,
        )

        if catch_ring and len(catch_ring) >= 4:
            features.append({
                "type": "Feature",
                "id": f"catchment_{c['rank']}",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [catch_ring],
                },
                "properties": {
                    "feature_type": "catchment_area",
                    "pond_rank": c["rank"],
                    "label": f"Catchment #{c['rank']}",
                    "catchment_area_m2": round(
                        c["catchment_area_m2"], 2
                    ),
                    "catchment_area_ha": round(
                        c["catchment_area_ha"], 4
                    ),
                    "catchment_area_km2": round(
                        c["catchment_area_m2"] / 1e6,
                        6,
                    ),
                    "score": round(c["score"], 4),

                    # These are read by common GeoJSON map viewers.
                    "stroke": "#4a90d9",
                    "stroke-width": 1.5,
                    "stroke-opacity": 0.6,
                    "fill": "#a8c8f0",
                    "fill-opacity": 0.25,
                },
            })

        # Inner polygon: part of the catchment that meets the
        # depression-depth requirement.
        dep_cells = c.get("depression_cells", [])

        if dep_cells:
            dep_ring = catchment_to_polygon(
                dep_cells,
                meta,
            )

            if dep_ring and len(dep_ring) >= 4:
                dep_area_m2 = (
                    len(dep_cells)
                    * meta["cell_area_m2"]
                )

                features.append({
                    "type": "Feature",
                    "id": f"pond_site_{c['rank']}",
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [dep_ring],
                    },
                    "properties": {
                        "feature_type": "pond_site",
                        "pond_rank": c["rank"],
                        "label": f"Pond Site #{c['rank']}",
                        "depression_area_m2": round(
                            dep_area_m2, 2
                        ),
                        "depression_area_ha": round(
                            dep_area_m2 / 10_000,
                            4,
                        ),
                        "max_depression_m": round(
                            c["depression_depth_m"],
                            3,
                        ),

                        "stroke": "#1a5276",
                        "stroke-width": 3,
                        "stroke-opacity": 0.95,
                        "fill": "#2980b9",
                        "fill-opacity": 0.55,
                    },
                })

        # Point feature for the actual pond candidate.
        features.append({
            "type": "Feature",
            "id": f"pond_{c['rank']}",
            "geometry": {
                "type": "Point",
                "coordinates": [
                    round(c["lon"], 6),
                    round(c["lat"], 6),
                ],
            },
            "properties": {
                "feature_type": "pond_candidate",
                "rank": c["rank"],
                "label": f"Candidate #{c['rank']}",
                "score": round(c["score"], 4),

                "marker-color": "#1a5276",
                "marker-size": "large",
                "marker-symbol": "water",

                "longitude": round(c["lon"], 6),
                "latitude": round(c["lat"], 6),
                "elevation_m": round(c["elevation_m"], 2),
                "depression_depth_m": round(
                    c["depression_depth_m"],
                    3,
                ),
                "slope_deg": round(c["slope_deg"], 2),
                "is_river": c.get("is_river", False),

                "catchment_area_m2": round(
                    c["catchment_area_m2"], 2
                ),
                "catchment_area_ha": round(
                    c["catchment_area_ha"], 4
                ),
                "catchment_area_km2": round(
                    c["catchment_area_m2"] / 1e6,
                    6,
                ),
                "catchment_n_cells": c["n_cells"],
                "catchment_elev_min_m": round(
                    c.get("elev_min_m", 0),
                    2,
                ),
                "catchment_elev_max_m": round(
                    c.get("elev_max_m", 0),
                    2,
                ),
                "catchment_mean_slope_deg": round(
                    c.get("slope_mean_deg", 0),
                    2,
                ),

                "annual_rainfall_mm": c.get(
                    "annual_rainfall_mm",
                    0,
                ),
                "annual_rainfall_source": c.get(
                    "annual_rainfall_source",
                    "fallback",
                ),
                "estimated_annual_runoff_m3": c.get(
                    "estimated_annual_runoff_m3",
                    0,
                ),
                "runoff_coefficient": c.get(
                    "runoff_coefficient",
                    0.30,
                ),

                "recommended_pond_depth_m": c.get(
                    "recommended_pond_depth_m",
                    3.5,
                ),
                "recommended_storage_m3": c.get(
                    "recommended_storage_m3",
                    0,
                ),
                "estimated_pond_surface_m2": c.get(
                    "estimated_pond_surface_m2",
                    0,
                ),
                "estimated_pond_radius_m": c.get(
                    "estimated_pond_radius_m",
                    0,
                ),
                "flow_acc_norm": round(
                    c.get("flow_acc", 0),
                    4,
                ),
            },
        })

    bounds = {
        k: round(meta[k], 6)
        for k in (
            "lon_min",
            "lon_max",
            "lat_min",
            "lat_max",
        )
    }

    area_km2 = round(
        (meta["lon_max"] - meta["lon_min"])
        * (meta["lat_max"] - meta["lat_min"])
        * 111
        * 111,
        3,
    )

    return {
        "type": "FeatureCollection",
        "metadata": {
            "algorithm": (
                "Original-DEM D8 + Priority-Flood + "
                "reverse-BFS catchment"
            ),
            "river_exclusion": (
                "Flow-acc ≥ 93rd-pct (flow_dir!=NO_DIR) "
                "+ 10-cell buffer"
            ),
            "flat_area_fix": (
                "1 mm perturbation on original DEM "
                "before D8 (seed=42)"
            ),
            "grid_resolution": meta["resolution"],
            "cell_area_m2": round(
                meta["cell_area_m2"],
                2,
            ),
            "study_area_bounds": bounds,
            "study_area_km2": area_km2,
            "elevation_range_m": {
                "min": round(meta["elev_min"], 2),
                "max": round(meta["elev_max"], 2),
            },
            "n_contours_input": meta["n_contours"],
            "n_sample_pts": meta["n_pts"],
            "n_candidates_returned": len(top),
            "features_per_candidate": (
                "catchment_area + pond_site "
                "+ pond_candidate (point)"
            ),
            "crs": "EPSG:4326",
        },
        "features": features,
    }