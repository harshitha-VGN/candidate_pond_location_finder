"""
config.py - CSD Pond Planning API

All tunable parameters are kept here so that the main processing code
doesn't have to contain these values directly.
"""

GRID_RESOLUTION: int = 120

SAMPLE_SPACING_M: float = 20.0

SMOOTH_SIGMA: float = 1.5

INTERP_METHOD: str = "linear"

DEM_PERTURB: float = 0.001   # metres - breaks flat-area flow ties

RIVER_PERCENTILE: float = 90.0   # top 10% flow-acc = river

RIVER_BUFFER_CELLS: int = 6       # ~150 m spatial buffer around river channel

RIVER_SINK_FLOW_FRACTION: float = 0.55

MIN_ELEVATION_PERCENTILE: float = 15.0

MIN_CATCHMENT_AREA_HA: float = 1.0

MIN_CATCHMENT_CELLS: int = 6

MAX_CATCHMENT_FRACTION: float = 0.55

MIN_POND_DIST_CELLS: int = 15

MIN_DEPRESSION_M: float = 1.5

W_CATCHMENT: float = 0.45

W_SLOPE: float = 0.30

W_DEPTH: float = 0.25

TOP_N: int = 5

RUNOFF_COEFF: float = 0.30

POND_DEPTH_M: float = 3.0

FREEBOARD_M: float = 0.50

METEO_START: str = "2018-01-01"

METEO_END: str = "2025-12-31"

METEO_TIMEOUT: int = 10

FALLBACK_RAIN_M: float = 0.800

MAX_UPLOAD_MB: int = 50