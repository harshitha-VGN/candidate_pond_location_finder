# CSD Pond Planning API — Technical Report

## 1. Project Overview

This project implements a **backend REST API** that accepts contour map data in KML/KMZ format, performs hydrological terrain analysis, identifies suitable pond locations, and estimates the corresponding catchment area for each candidate site.

The API is fully generalised — no coordinates, elevations, or results are hardcoded. All analysis is derived algorithmically from the input contour map, making it applicable to any terrain in KML/KMZ format.

---

## 2. API Endpoints

### Base URL
```
http://localhost:5000
```

### POST /analyzeContour
Main endpoint for terrain analysis and catchment delineation.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `file` | File (form-data) | Yes | `.kml` or `.kmz` contour map |
| `top_n` | Integer | No (default: 5) | Number of pond candidates to return (max 10) |
| `grid_res` | Integer | No (default: 120) | DEM grid resolution in cells per axis (range: 50-300) |

**Content-Type:** `multipart/form-data`

### POST /findCatchment
Alias for `/analyzeContour` — identical behaviour.

### GET /health
Liveness probe. Returns `{"status": "ok"}`.

### GET /api/info
Returns all hardcoded parameters and endpoint documentation as JSON.

---

## 3. Algorithm & Technical Approach

### 3.1 Input Parsing
The uploaded `.kml` or `.kmz` file is parsed using Python's `zipfile` and `xml.etree.ElementTree` modules. Each `<Placemark>` containing a `<LineString>` is treated as a contour line with an associated elevation extracted from the placemark name. Points are sampled along each contour at `SAMPLE_SPACING_M = 20 m` intervals to build a dense point cloud.

### 3.2 Digital Elevation Model (DEM) Construction
The sampled contour points are interpolated onto a regular `120 x 120` grid using **linear interpolation** (`scipy.interpolate.griddata`). A **Gaussian smoothing filter** (`sigma = 1.5` cells) is applied to remove interpolation artefacts. The result is a continuous DEM over the study area.

### 3.3 D8 Flow Direction (Original DEM + Perturbation)
The **D8 (8-direction) flow routing** algorithm is applied to the DEM. A critical improvement over naive D8:

> **Flat-area fix:** A tiny random perturbation (`1 mm`, seed=42) is added to the original DEM *before* computing flow direction. This breaks elevation ties in flat areas (such as floodplains) without distorting real terrain. Without this, flat areas produce undefined flow directions (NO_DIR), causing the upstream BFS to stall after only a few cells — resulting in artificially tiny catchments.

Each cell is assigned a flow direction toward the lowest of its 8 neighbours. Cells with no lower neighbour are marked as local minima (NO_DIR) — these are natural water collection points.

### 3.4 Flow Accumulation
Flow accumulation is computed in a single pass sorted from highest to lowest elevation (O(N log N)). Each cell's count propagates downstream following the D8 directions. The result is normalised to [0, 1] relative to the grid maximum.

### 3.5 River / Stream Detection
River channels are identified as cells where:
```
flow_accumulation >= 90th percentile  AND  flow_direction != NO_DIR
```

The second condition (`flow_dir != NO_DIR`) is critical: **local minima always accumulate the highest flow** (they are collection points), but they are *not* river channels — they are pour points. Without this condition, every pond candidate (which IS a local minimum) would be classified as a river and the algorithm would return zero results.

### 3.6 River Exclusion (Three-Layer Defence)
To prevent pond candidates from being placed in or near rivers, three independent filters are applied:

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Layer 1 — Spatial buffer | 6-cell morphological dilation of river mask | Excludes candidates within ~150 m of detected channel |
| Layer 2 — Flow-acc filter | Exclude local minima with acc >= 55% of grid max | Removes river floodplain sinks missed by the buffer |
| Layer 3 — Elevation floor | Exclude cells below the 15th percentile elevation | Removes remaining low-lying river valley candidates |

A safety check ensures the combined exclusion zone never exceeds 60% of the grid (prevents "no candidates" errors on large rivers).

### 3.7 Candidate Detection via BFS
Local minima surviving all three filters are treated as **pond candidates** (natural pour points). For each candidate, a **Breadth-First Search (BFS) on the reverse flow-direction graph** traces all cells that drain into it — this defines the upstream catchment.

The BFS naturally terminates at drainage divides (ridges), where no upstream neighbours exist. This avoids the need for explicit ridge detection.

Candidates are filtered by:
- **Minimum catchment area:** 1.0 ha
- **Maximum catchment fraction:** 55% of total grid area (avoids the single dominant basin)
- **Spatial NMS (Non-Maximum Suppression):** Minimum 15-cell separation between candidates

### 3.8 Scoring & Ranking
Each candidate is scored as a weighted sum of three normalised factors:

```
score = 0.45 x norm(catchment_area)
      + 0.30 x (1 - norm(slope_deg))    <- gentler slope scores higher
      + 0.25 x norm(depression_depth_m)
```

Candidates are ranked by score and the top N are returned.

### 3.9 Rainfall & Runoff Estimation
Annual rainfall is fetched from the **Open-Meteo Historical Weather API** (ERA5 reanalysis, 2018-2025) using the candidate's latitude/longitude. If the API is unavailable, a fallback of `800 mm/yr` is used.

Estimated annual runoff is computed using the **Rational Method**:
```
Annual runoff (m3) = C x Rainfall (m) x Catchment area (m2)
                   where C = 0.30 (runoff coefficient)
```

### 3.10 GeoJSON Output
The response is a **GeoJSON FeatureCollection (EPSG:4326)** with three features per candidate:

| Feature | Geometry | Description |
|---------|----------|-------------|
| `catchment_area` | Polygon | Full upstream watershed (light blue, 25% opacity) |
| `pond_site` | Polygon | Depression bowl / immediate collection zone (dark border) |
| `pond_candidate` | Point | Exact pour-point location with all computed attributes |

Catchment polygons are smoothed using **Gaussian blur** (`sigma = 2.0`) before marching-squares contouring, producing organic watershed-shaped boundaries instead of pixel staircases.

---

## 4. Hardcoded Parameters

All parameters are centralised in `config.py`:

| Parameter | Value | Description |
|-----------|-------|-------------|
| `GRID_RESOLUTION` | 120 | DEM grid cells per axis (120x120 = 14,400 cells) |
| `SAMPLE_SPACING_M` | 20 m | Point sampling interval along contour lines |
| `SMOOTH_SIGMA` | 1.5 | Gaussian DEM smoothing sigma (cells) |
| `INTERP_METHOD` | linear | Griddata interpolation method |
| `DEM_PERTURB` | 0.001 m | Noise amplitude for flat-area tie-breaking (seed=42) |
| `RIVER_PERCENTILE` | 90.0 | Flow-acc threshold for river channel detection |
| `RIVER_BUFFER_CELLS` | 6 | Spatial exclusion buffer around river mask |
| `RIVER_SINK_FLOW_FRACTION` | 0.55 | Flow-acc fraction above which a local min = river sink |
| `MIN_ELEVATION_PERCENTILE` | 15.0 | Candidates must be above this elevation percentile |
| `MIN_CATCHMENT_AREA_HA` | 1.0 ha | Minimum catchment area for a valid candidate |
| `MAX_CATCHMENT_FRACTION` | 0.55 | Max fraction of grid a catchment may occupy |
| `MIN_POND_DIST_CELLS` | 15 | NMS suppression radius (grid cells) |
| `MIN_DEPRESSION_M` | 1.5 m | Minimum depression depth for the pond-site polygon |
| `W_CATCHMENT` | 0.45 | Scoring weight: catchment area |
| `W_SLOPE` | 0.30 | Scoring weight: slope gentleness |
| `W_DEPTH` | 0.25 | Scoring weight: depression depth |
| `TOP_N` | 5 | Default number of candidates returned |
| `RUNOFF_COEFF` | 0.30 | Rational method coefficient C |
| `POND_DEPTH_M` | 3.0 m | Recommended excavation depth |
| `FREEBOARD_M` | 0.50 m | Safety buffer above max water level |
| `METEO_START` | 2018-01-01 | Historical rainfall start date |
| `METEO_END` | 2025-12-31 | Historical rainfall end date (last complete year) |
| `FALLBACK_RAIN_M` | 0.800 m | Fallback annual rainfall when API unavailable |
| `MAX_UPLOAD_MB` | 50 MB | Maximum file upload size |

---

## 5. Sample API Response (Abbreviated)

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "algorithm": "Original-DEM D8 + Priority-Flood + reverse-BFS catchment",
    "river_exclusion": "3-layer: spatial buffer + flow-acc filter + elevation floor",
    "grid_resolution": 120,
    "cell_area_m2": 616.0,
    "study_area_km2": 8.87,
    "elevation_range_m": { "min": 30.0, "max": 298.0 },
    "n_contours_input": 1356,
    "n_candidates_returned": 5,
    "processing_time_s": 4.5
  },
  "features": [
    {
      "type": "Feature",
      "id": "pond_1",
      "geometry": { "type": "Point", "coordinates": [81.291, 21.252] },
      "properties": {
        "feature_type": "pond_candidate",
        "rank": 1,
        "latitude": 21.252,
        "longitude": 81.291,
        "elevation_m": 87.5,
        "catchment_area_ha": 12.34,
        "annual_rainfall_mm": 1406.8,
        "estimated_annual_runoff_m3": 45278.0,
        "recommended_pond_depth_m": 3.5,
        "score": 0.8721
      }
    }
  ]
}
```

---

## 6. Technology Stack

| Component | Library / Tool |
|-----------|---------------|
| Web framework | Flask 3.x + Flask-CORS |
| Geospatial parsing | Python xml.etree, zipfile |
| Numerical computation | NumPy, SciPy |
| Interpolation | scipy.interpolate.griddata |
| Morphological ops | scipy.ndimage |
| Polygon contouring | scikit-image (marching squares) |
| Rainfall data | Open-Meteo Historical API (ERA5) |
| HTTP requests | requests |

---

## 7. Project Structure

```
csd_pond/
├── app.py              Flask application — routes and pipeline orchestration
├── config.py           All hardcoded parameters (single source of truth)
├── kml_parser.py       KML/KMZ parsing and contour line extraction
├── dem_builder.py      Point cloud to interpolated DEM
├── terrain_analysis.py D8 flow direction, flow accumulation, river detection
├── catchment.py        BFS upstream delineation, candidate selection, NMS
├── pond_selector.py    Scoring, ranking, Open-Meteo rainfall integration
├── geojson_builder.py  GeoJSON FeatureCollection construction
└── requirements.txt    Python dependencies
```

---

## 8. Setup & Running

### Prerequisites
- Python 3.10+
- Virtual environment recommended

### Install dependencies
```bash
pip install flask flask-cors numpy scipy scikit-image requests
```

### Run the server
```bash
cd csd_pond
python3 app.py
```
Server starts on `http://localhost:5000`.

### Test with Postman
```
Method  : POST
URL     : http://localhost:5000/analyzeContour
Body    : form-data
  Key   : file   (Type = File)   -> select your .kml or .kmz file
  Key   : top_n  (Type = Text)   -> 5  (optional)
```

---

## 9. Key Design Decisions

### Why original DEM + perturbation instead of filled DEM?
After depression-filling, flat interior cells share the same elevation. D8 cannot determine flow direction (NO_DIR). BFS from a local minimum hits these cells and stops immediately — catchment of 3-4 cells only. Adding 1 mm of random noise ensures every cell has a uniquely lowest neighbour, enabling full watershed traversal.

### Why exclude NO_DIR cells from the river mask?
A local minimum accumulates all upstream flow, so it always scores in the top percentile of flow accumulation. Without the `flow_dir != NO_DIR` condition, every pond candidate IS classified as a river — yielding zero results.

### Why three-layer river exclusion?
A single spatial buffer fails when the detected channel is narrow but the physical floodplain is wide. The flow-accumulation filter catches floodplain sinks physically far from the channel. The elevation floor provides a final barrier for any remaining low-lying candidates.

### Why Gaussian blur for polygon smoothing?
Binary dilation of a raster mask produces a staircase boundary. Gaussian blur converts the binary mask to a smooth gradient; marching squares at the 0.5 iso-line traces a smooth organic curve matching the natural watershed shape.

---

## 10. Limitations & Future Work

- **Grid resolution:** At 120x120, each cell is ~25x22 m. Finer resolution gives more accurate catchments but increases processing time quadratically.
- **Interpolation artefacts:** `griddata` linear interpolation can create small spurious depressions between widely-spaced contour lines.
- **River detection:** Uses flow accumulation as a proxy. For maps with multiple river systems, explicit river polyline input would improve exclusion accuracy.
- **Rainfall:** Open-Meteo provides area-averaged ERA5 data. Station-level rain gauge data would improve runoff estimates.
- **Soil type:** The rational method coefficient C = 0.30 assumes moderate agricultural slope. Adding soil classification from external APIs would make this site-specific.
