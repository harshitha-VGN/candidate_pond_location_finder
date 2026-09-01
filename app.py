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

from flask import Flask, request, jsonify
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


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "CSD Pond Planning API",
        "version": "1.0",
    })



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