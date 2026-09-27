# 🌊 HydroPond AI | Village Pond Planning & Catchment Delineation System

[![Python 3.10+](https://img.shields.io/badge/Python-3.10+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Flask](https://img.shields.io/badge/Flask-2.0+-black.svg?logo=flask&logoColor=white)](https://flask.palletsprojects.com/)
[![Leaflet](https://img.shields.io/badge/Leaflet-1.9.4-199900.svg?logo=leaflet&logoColor=white)](https://leafletjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An end-to-end AI-assisted geospatial decision-support platform for village pond site selection, digital elevation modeling, upstream catchment basin delineation, and expected rainwater harvesting volume estimation.

---

## 📌 Project Information

- **GitHub Repository:** [https://github.com/harshitha-VGN/candidate_pond_location_finder.git](https://github.com/harshitha-VGN/candidate_pond_location_finder.git)
- **Backend API Route:** `http://localhost:5000/analyzeContour`
- **Frontend Path:** `frontend/index.html` (Open directly in any modern web browser or serve via static host)

---

## 🚀 Key Features

- **Interactive Land Area Selection:** Draw bounding boxes or freeform polygons directly on satellite maps, upload raw `.kml`/`.kmz` contour files, or choose from pre-calibrated rural village watershed benchmarks.
- **Topographic & Elevation Modeling (DEM):** Bicubic spatial interpolation with Gaussian smoothing across regular raster grids ($50 \times 50$ up to $300 \times 300$).
- **Deterministic Flow Routing:** $1\,\text{mm}$ stochastic micro-perturbations to resolve flat-plateau flow ambiguities, followed by D8 steepest-descent flow direction routing.
- **River Channel & Floodway Exclusion:** Flow accumulation thresholding ($\ge 93\text{rd}$ percentile) with a $150\,\text{m}$ spatial buffer to prevent building ponds in hazardous flash-flood paths.
- **Catchment Delineation via Reverse-BFS:** Graph traversal in reverse from natural topographic depressions to delineate exact contributing upstream drainage basins.
- **Multi-Criteria Scoring:** Weighted ranking balancing catchment area ($45\%$), flat terrain slope ($30\%$), and depression depth ($25\%$) with Non-Maximum Suppression (NMS).
- **Historical Rainfall Integration & Sizing:** Automated querying of multi-year (2018–2025) daily rainfall from the Open-Meteo Historical Archive API, calculating annual runoff ($Q = C \cdot P \cdot A$), target storage ($50\%$ yield), recommended depth ($3.5\,\text{m}$ with freeboard), and pond surface area.
- **Web-GIS Visual Overlays:** Interactive rendering of satellite imagery, catchment polygon boundaries, depression site basins, and ranked pulsing markers with detailed popup inspection tables.

---

## 📂 Project Directory Structure

```text
candidate_pond_location_finder/
│
├── frontend/                       # Interactive Web-GIS User Interface
│   ├── index.html                  # Main Web-GIS application shell & sidebar
│   ├── style.css                   # Modern aesthetic stylesheet with glassmorphism
│   ├── app.js                      # Map controller, Leaflet drawing, & API integration
│   └── sample_data.js              # Benchmark watershed datasets & KML generator
│
├── app.py                          # Flask REST API server and pipeline controller
├── kml_parser.py                   # KML / KMZ parser extracting 3D contour vertices
├── dem_builder.py                  # Bicubic DEM raster builder and grid metadata
├── terrain_analysis.py             # D8 flow routing, flow accumulation, river detection
├── catchment.py                    # Local minima filtering and reverse-BFS catchment delineation
├── pond_selector.py                # Multi-criteria scoring, Open-Meteo rainfall, runoff sizing
├── geojson_builder.py              # Standard GeoJSON FeatureCollection builder
│
├── report.tex                      # Complete 10-page ACM manuscript technical report
├── DEMO_VIDEO_SCRIPT.md            # 5-minute video walkthrough script and demo guide
├── requirements.txt                # Python backend dependencies
└── README.md                       # Comprehensive documentation
```

---

## 💻 Quick Start & Running Locally

### 1. Backend Service

```bash
# Clone repository
git clone https://github.com/harshitha-VGN/candidate_pond_location_finder.git
cd candidate_pond_location_finder

# Install dependencies
pip install -r requirements.txt

# Run Flask server (Default port: 5000)
python app.py
```

The API will be available at `http://localhost:5000`.

### 2. Frontend Web Interface

The frontend is a standalone, zero-build Web-GIS application. You can launch it using any of the following methods:

**Method A: Python Simple HTTP Server**
```bash
python3 -m http.server 8080 --directory frontend
```
Then open `http://localhost:8080` in your web browser.

**Method B: Node.js Serve / NPX**
```bash
npx -y serve frontend -p 3000
```
Then open `http://localhost:3000`.

**Method C: Direct Browser Launch**
Simply double-click `frontend/index.html` in your file explorer to open it in Chrome, Edge, Safari, or Firefox.

---

## 📡 API Specification

### `POST /analyzeContour`

Submits contour data for full hydrological analysis and pond candidate selection.

- **Content-Type:** `multipart/form-data`
- **Parameters:**
  - `file`: (Required) Uploaded `.kml` or `.kmz` contour file.
  - `top_n`: (Optional, int 1–10, default `5`) Number of top candidate sites to return.
  - `grid_res`: (Optional, int 50–300, default `120`) Raster DEM grid resolution.

#### Example cURL Request

```bash
curl -X POST http://localhost:5000/analyzeContour \
  -F "file=@sample_contours.kml" \
  -F "top_n=5" \
  -F "grid_res=120"
```

#### Response Format (GeoJSON FeatureCollection)

```json
{
  "type": "FeatureCollection",
  "metadata": {
    "algorithm": "Original-DEM D8 + Priority-Flood + reverse-BFS catchment",
    "grid_resolution": 120,
    "cell_area_m2": 1540.2,
    "study_area_km2": 24.15,
    "elevation_range_m": { "min": 785.4, "max": 892.1 },
    "n_candidates_returned": 3,
    "processing_time_s": 1.48
  },
  "features": [
    {
      "type": "Feature",
      "id": "catchment_1",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "properties": {
        "feature_type": "catchment_area",
        "pond_rank": 1,
        "catchment_area_ha": 48.25,
        "catchment_area_m2": 482500.0,
        "score": 0.9124
      }
    },
    {
      "type": "Feature",
      "id": "pond_site_1",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "properties": {
        "feature_type": "pond_site",
        "pond_rank": 1,
        "depression_area_ha": 1.845,
        "max_depression_m": 2.85
      }
    },
    {
      "type": "Feature",
      "id": "pond_1",
      "geometry": { "type": "Point", "coordinates": [78.1452, 13.1348] },
      "properties": {
        "feature_type": "pond_candidate",
        "rank": 1,
        "score": 0.9124,
        "elevation_m": 804.2,
        "catchment_area_ha": 48.25,
        "annual_rainfall_mm": 745.2,
        "estimated_annual_runoff_m3": 107869.5,
        "recommended_storage_m3": 53934.8,
        "recommended_pond_depth_m": 3.5,
        "estimated_pond_radius_m": 107.0
      }
    }
  ]
}
```

---

## 🔬 Core Algorithms & Mathematical Formulas

1. **Bicubic DEM Interpolation:**
   $$z(x, y) = \sum_{p=0}^3 \sum_{q=0}^3 a_{pq} x^p y^q$$
2. **D8 Steepest Descent Routing:**
   $$d^*(r, c) = \arg\max_{k \in \{0..7\}} \frac{z(r, c) - z(r + \Delta r_k, c + \Delta c_k)}{\text{dist}(k)}$$
3. **Rational Method Runoff Volume:**
   $$Q = C \times \left(\frac{P_{\text{annual}}}{1000}\right) \times A_{\text{catchment}}$$
   *(where $C = 0.30$, $P_{\text{annual}}$ is precipitation in mm, $A_{\text{catchment}}$ is area in $\text{m}^2$)*
4. **Target Storage & Pond Geometry:**
   $$V_{\text{target}} = 0.50 \times Q, \quad D_{\text{pond}} = 3.50\,\text{m}, \quad A_{\text{surface}} = \frac{V_{\text{target}}}{0.5 \times 3.0}, \quad R = \sqrt{\frac{A_{\text{surface}}}{\pi}}$$

---

## 🏛️ CSD Themes & Architectural Highlights

| CSD Theme | Implementation | Design Rationale |
|---|---|---|
| **REST API Design** | Flask `POST /analyzeContour` | Stateless RFC 7946 GeoJSON contract allowing independent frontend/backend evolution. |
| **In-Memory Caching** | Coordinate hash cache in `pond_selector.py` | Reduces rainfall query latency from $\sim 800\,\text{ms}$ to $< 1\,\text{ms}$ for adjacent queries. |
| **Modular Monolith** | Single-process NumPy pipeline | Eliminates inter-process matrix serialization latency for 2D DEM rasters. |
| **Fault Resilience** | Default fallback constants ($800\,\text{mm}$) | Graceful system degradation when external meteorological services are unreachable. |

