"""
pond_selector.py - Score pond candidates and estimate pond design values.

Candidate score:
    catchment area + slope + depression depth

The pond-design calculation uses annual rainfall, catchment area and
the runoff coefficient to estimate runoff and required storage.
"""

import logging

import requests
import numpy as np

from config import (
    W_CATCHMENT,
    W_SLOPE,
    W_DEPTH,
    TOP_N,
    RUNOFF_COEFF,
    POND_DEPTH_M,
    FREEBOARD_M,
    METEO_START,
    METEO_END,
    METEO_TIMEOUT,
    FALLBACK_RAIN_M,
)


log = logging.getLogger(__name__)

# Cache rainfall values so the same location does not need another API call.
_rain_cache: dict = {}


def score_and_select(
    candidates: list,
    n: int = TOP_N,
) -> list:
    if not candidates:
        return []

    areas = np.array(
        [c["catchment_area_m2"] for c in candidates],
        float,
    )

    slopes = np.array(
        [c["slope_deg"] for c in candidates],
        float,
    )

    depths = np.array(
        [c["depression_depth_m"] for c in candidates],
        float,
    )

    def norm(a):
        lo, hi = a.min(), a.max()

        if hi - lo < 1e-9:
            return np.ones_like(a) * 0.5

        return (a - lo) / (hi - lo)

    scores = (
        W_CATCHMENT * norm(areas)
        + W_SLOPE * (1 - norm(slopes))
        + W_DEPTH * norm(depths)
    )

    results = []

    for rank, idx in enumerate(
        np.argsort(-scores)[:n],
        1,
    ):
        c = dict(candidates[idx])

        c["rank"] = rank
        c["score"] = float(scores[idx])

        c.update(_pond_design(c))
        results.append(c)

    return results


def _pond_design(c: dict) -> dict:
    rain_m = _get_rainfall(
        c["lat"],
        c["lon"],
    )

    area_m2 = c["catchment_area_m2"]

    runoff_m3 = (
        RUNOFF_COEFF
        * rain_m
        * area_m2
    )

    storage_m3 = runoff_m3 * 0.50

    depth_m = POND_DEPTH_M

    surface_m2 = (
        storage_m3 / (0.5 * depth_m)
        if depth_m > 0
        else 0
    )

    radius_m = (
        float(np.sqrt(surface_m2 / np.pi))
        if surface_m2 > 0
        else 0
    )

    return {
        "annual_rainfall_mm": round(
            rain_m * 1000,
            1,
        ),
        "annual_rainfall_source": _rain_cache.get(
            (
                round(c["lat"], 2),
                round(c["lon"], 2),
            ),
            {},
        ).get(
            "source",
            "fallback",
        ),
        "estimated_annual_runoff_m3": round(
            runoff_m3,
            2,
        ),
        "runoff_coefficient": RUNOFF_COEFF,
        "recommended_pond_depth_m": round(
            depth_m + FREEBOARD_M,
            2,
        ),
        "recommended_storage_m3": round(
            storage_m3,
            2,
        ),
        "estimated_pond_surface_m2": round(
            surface_m2,
            2,
        ),
        "estimated_pond_radius_m": round(
            radius_m,
            2,
        ),
    }


def _get_rainfall(
    lat: float,
    lon: float,
) -> float:
    """
    Get mean annual rainfall from the Open-Meteo historical API.

    If the request fails, the configured fallback rainfall value is used.
    Results are cached using coordinates rounded to two decimal places.
    """

    key = (
        round(lat, 2),
        round(lon, 2),
    )

    if key in _rain_cache:
        v = _rain_cache[key]

        return (
            v["value"]
            if isinstance(v, dict)
            else v
        )

    try:
        r = requests.get(
            "https://archive-api.open-meteo.com/v1/archive",
            params={
                "latitude": lat,
                "longitude": lon,
                "start_date": METEO_START,
                "end_date": METEO_END,
                "daily": "precipitation_sum",
                "timezone": "auto",
            },
            timeout=METEO_TIMEOUT,
        )

        if r.status_code == 200:
            daily = [
                p
                for p in (
                    r.json().get("daily") or {}
                ).get(
                    "precipitation_sum",
                    [],
                )
                if p is not None
            ]

            if daily:
                annual_m = (
                    sum(daily)
                    / 1000.0
                    / (len(daily) / 365.25)
                )

                log.info(
                    "Open-Meteo: %.1f mm/yr at (%.3f, %.3f)",
                    annual_m * 1000,
                    lat,
                    lon,
                )

                _rain_cache[key] = {
                    "value": annual_m,
                    "source": "open-meteo",
                }

                return annual_m

    except Exception as e:
        log.warning(
            "Open-Meteo error: %s — using fallback",
            e,
        )

    _rain_cache[key] = {
        "value": FALLBACK_RAIN_M,
        "source": "fallback",
    }

    return FALLBACK_RAIN_M