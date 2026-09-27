"""
app.py - CSD Pond Planning API (Flask)

Routes
------
GET  /health
POST /analyzeContour

Postman usage
-------------
POST http://localhost:5000/analyzeContour

Body -> form-data
    file      : <your .kml or .kmz>   (required)
    top_n     : 5                      (optional int, 1-10)
    grid_res  : 120                    (optional int, 50-300)
"""

import os
import tempfile
import logging
import time
import urllib.request
import urllib.parse
import json

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

MAX_UPLOAD_MB: int = 50
TOP_N: int = 5
GRID_RESOLUTION: int = 120
RIVER_BUFFER_CELLS: int = 6   # ~150 m spatial buffer around river channel
from kml_parser import parse_kml_kmz
from dem_builder import build_dem
from terrain_analysis import (
    add_perturbation,
    compute_flow_direction,
    compute_flow_accumulation,
    detect_rivers,
)
from catchment import find_pond_candidates
from pond_selector import score_and_select
from geojson_builder import build_geojson


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

ALLOWED = {".kml", ".kmz"}


FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "CSD Pond Planning API",
        "version": "1.0",
    })


@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    file_path = os.path.join(FRONTEND_DIR, filename)
    if os.path.isfile(file_path):
        return send_from_directory(FRONTEND_DIR, filename)
@app.route("/api/searchVillage", methods=["GET"])
def search_village_api():
    query = request.args.get("q", "").strip()
    if not query or len(query) < 2:
        return jsonify({"results": []}), 200

    results = []
    # 1. Query Photon OpenStreetMap GeoEngine API
    try:
        url = "https://photon.komoot.io/api/?q=" + urllib.parse.quote(query) + "&lang=en"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "CSDPondPlannerResearch/1.0 (academic-research@csd.ac.in)"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            for feat in data.get("features", []):
                p = feat.get("properties", {})
                if p.get("countrycode") == "IN" or p.get("country") == "India":
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    if len(coords) >= 2:
                        lon = float(coords[0])
                        lat = float(coords[1])
                        name = p.get("name") or query
                        taluk = p.get("county") or p.get("city") or ""
                        district = p.get("district") or p.get("county") or ""
                        state = p.get("state") or ""
                        postcode = p.get("postcode") or ""
                        place_type = p.get("osm_value") or p.get("type") or "village"
                        results.append({
                            "name": name,
                            "type": place_type,
                            "taluk": taluk,
                            "district": district,
                            "state": state,
                            "postcode": postcode,
                            "lat": lat,
                            "lon": lon,
                            "bounds": {
                                "minLat": lat - 0.0225,
                                "maxLat": lat + 0.0225,
                                "minLon": lon - 0.0300,
                                "maxLon": lon + 0.0300
                            },
                            "source": "Photon-OSM Live API"
                        })
    except Exception as e:
        log.warning("Photon API error: %s", e)

    # 2. Fallback to Nominatim if Photon returns few results
    if len(results) < 3:
        try:
            nom_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query + ', India')}&format=json&countrycodes=in&addressdetails=1&limit=6"
            nom_req = urllib.request.Request(
                nom_url,
                headers={"User-Agent": "CSDPondPlannerResearch/1.0 (academic-research@csd.ac.in)"}
            )
            with urllib.request.urlopen(nom_req, timeout=5) as resp:
                nom_data = json.loads(resp.read().decode())
                for item in nom_data:
                    lat = float(item.get("lat"))
                    lon = float(item.get("lon"))
                    addr = item.get("address", {})
                    vname = addr.get("village") or addr.get("suburb") or addr.get("town") or addr.get("hamlet") or item.get("name") or query
                    taluk = addr.get("county") or addr.get("subdistrict") or ""
                    dist = addr.get("state_district") or addr.get("district") or addr.get("county") or ""
                    state = addr.get("state") or ""
                    # Avoid duplicates
                    if not any(abs(r["lat"] - lat) < 0.005 and abs(r["lon"] - lon) < 0.005 for r in results):
                        results.append({
                            "name": vname,
                            "type": "village",
                            "taluk": taluk,
                            "district": dist,
                            "state": state,
                            "postcode": addr.get("postcode", ""),
                            "lat": lat,
                            "lon": lon,
                            "bounds": {
                                "minLat": lat - 0.0225,
                                "maxLat": lat + 0.0225,
                                "minLon": lon - 0.0300,
                                "maxLon": lon + 0.0300
                            },
                            "source": "Nominatim Live API"
                        })
        except Exception as e:
            log.warning("Nominatim API fallback error: %s", e)

    return jsonify({"results": results[:12]}), 200





def _run_analysis(req):
    t0 = time.time()

    # Check the uploaded file before doing any processing.
    if "file" not in req.files:
        return jsonify({
            "error": "No file. Use form-data key 'file'."
        }), 400

    f = req.files["file"]

    if not f or f.filename == "":
        return jsonify({"error": "Empty filename."}), 400

    ext = os.path.splitext(f.filename.lower())[1]

    if ext not in ALLOWED:
        return jsonify({
            "error": f"Only .kml / .kmz accepted. Got '{ext}'."
        }), 415

    f.seek(0, 2)
    mb = f.tell() / (1024 * 1024)
    f.seek(0)

    if mb > MAX_UPLOAD_MB:
        return jsonify({
            "error": (
                f"File {mb:.1f} MB > "
                f"{MAX_UPLOAD_MB} MB limit."
            )
        }), 413

    # Read the optional values and keep them inside their allowed ranges.
    try:
        top_n = max(
            1,
            min(int(req.form.get("top_n", TOP_N)), 10)
        )
        grid_res = max(
            50,
            min(int(req.form.get("grid_res", GRID_RESOLUTION)), 300)
        )
    except ValueError:
        return jsonify({
            "error": "top_n and grid_res must be integers."
        }), 400

    tmp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            delete=False,
            suffix=ext
        ) as tmp:
            f.save(tmp.name)
            tmp_path = tmp.name

        log.info(
            "Processing: %s  %.2f MB  top_n=%d  grid_res=%d",
            f.filename,
            mb,
            top_n,
            grid_res,
        )

        # 1. Read the contour information from the uploaded KML/KMZ.
        contours = parse_kml_kmz(tmp_path)

        # 2. Convert the contour points into a regular elevation grid.
        dem, meta = build_dem(contours, resolution=grid_res)

        # Use the original DEM for flow direction. The small perturbation
        # only helps when neighbouring cells have the same elevation.
        dem_pert = add_perturbation(dem)
        flow_dir = compute_flow_direction(dem_pert)

        # Flow accumulation and river detection use the same flow network.
        flow_acc = compute_flow_accumulation(dem_pert, flow_dir)
        river_mask = detect_rivers(flow_acc, flow_dir)

        # Keep some distance between detected rivers and possible pond sites.
        from scipy.ndimage import binary_dilation

        grid_size = dem.shape[0] * dem.shape[1]
        river_excl = binary_dilation(
            river_mask,
            iterations=RIVER_BUFFER_CELLS,
        ).astype(bool)

        excl_frac = river_excl.sum() / grid_size

        log.info(
            "River exclusion zone: %d / %d cells = %.1f%% of grid",
            int(river_excl.sum()),
            grid_size,
            excl_frac * 100,
        )

        # A very large exclusion area would leave too little of the map
        # available for finding candidates.
        if excl_frac > 0.60:
            log.warning(
                "Exclusion zone %.1f%% > 60%% — "
                "falling back to raw river mask",
                excl_frac * 100,
            )
            river_excl = river_mask

        # 3. Find possible pond locations and their upstream catchments.
        candidates = find_pond_candidates(
            dem,
            flow_acc,
            river_excl,
            meta,
            flow_dir,
        )

        if not candidates:
            return jsonify({
                "error": "No suitable pond locations found.",
                "hint": (
                    "Try a different KML or reduce "
                    "MIN_CATCHMENT_AREA_HA in config.py"
                ),
                "n_contours": len(contours),
            }), 422

        # 4. Rank the candidates and keep the requested number.
        top = score_and_select(candidates, n=top_n)

        # 5. Convert the selected candidates into GeoJSON.
        geojson = build_geojson(top, dem, meta, contours)
        geojson["metadata"]["processing_time_s"] = round(
            time.time() - t0,
            2,
        )

        log.info(
            "Done in %.2f s — %d candidates returned",
            time.time() - t0,
            len(top),
        )

        return jsonify(geojson), 200

    except ValueError as e:
        log.warning("Input error: %s", e)
        return jsonify({"error": str(e)}), 422

    except Exception as e:
        log.exception("Unexpected error")
        return jsonify({"error": f"Internal error: {e}"}), 500

    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.route("/analyzeContour", methods=["POST"])
def analyze_contour():
    return _run_analysis(request)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    log.info("Starting on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)