"""
app.py - CSD Pond Planning API (Flask) with OpenTelemetry Observability

Routes
------
GET  /health
GET  /metrics                     -> OpenTelemetry Prometheus scraping endpoint
GET  /observability               -> OpenTelemetry Live Observability Dashboard
GET  /api/telemetry/overview      -> Summary KPIs of traces, spans, and metrics
GET  /api/telemetry/traces        -> Trace waterfall and span tree inspection
GET  /api/telemetry/traces/<id>   -> Detailed span tree with attributes
GET  /api/telemetry/logs          -> Correlated logs stream with trace_id & span_id
GET  /api/telemetry/clear         -> Reset in-memory telemetry buffer
POST /api/sampleRun               -> Execute pipeline on bundled sample KML
GET  /api/searchVillage           -> Live OSM / Nominatim village search
POST /analyzeContour              -> Hydrological pond candidate pipeline
"""

import os
import tempfile
import logging
import time
import urllib.request
import urllib.parse
import json

from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
from opentelemetry.trace import StatusCode, Status

# Import OpenTelemetry subsystem
from telemetry import (
    setup_telemetry,
    get_tracer,
    get_meter,
    get_instruments,
    telemetry_store,
)

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

# Configure initial logging format
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Initialize OpenTelemetry instrumentation for Flask, HTTP clients, traces, metrics, and logs
setup_telemetry(app)
tracer = get_tracer()
instruments = get_instruments()

ALLOWED = {".kml", ".kmz"}
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend")
SAMPLE_KML_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sample_data", "contours_1m.kml")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "CSD Pond Planning API",
        "version": "1.0",
        "telemetry": "OpenTelemetry 1.45.1 enabled",
    })


@app.route("/", methods=["GET"])
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>", methods=["GET"])
def serve_static(filename):
    file_path = os.path.join(FRONTEND_DIR, filename)
    if os.path.isfile(file_path):
        return send_from_directory(FRONTEND_DIR, filename)
    return "Not Found", 404


@app.route("/api/searchVillage", methods=["GET"])
def search_village_api():
    query = request.args.get("q", "").strip()
    if not query or len(query) < 2:
        return jsonify({"results": []}), 200

    with tracer.start_as_current_span("village.search") as span:
        span.set_attribute("search.query", query)
        span.set_attribute("search.query_len", len(query))
        
        results = []
        # 1. Query Photon OpenStreetMap GeoEngine API
        try:
            url = "https://photon.komoot.io/api/?q=" + urllib.parse.quote(query) + "&lang=en"
            span.set_attribute("search.photon_url", url)
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "CSDPondPlannerResearch/1.0 (academic-research@csd.ac.in)"}
            )
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read().decode())
                features = data.get("features", [])
                span.set_attribute("search.photon_raw_count", len(features))
                
                for feat in features:
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
            span.record_exception(e)
            span.set_attribute("search.photon_error", str(e))

        # 2. Fallback to Nominatim if Photon returns few results
        if len(results) < 3:
            try:
                span.add_event("search.nominatim_fallback_start")
                nom_url = f"https://nominatim.openstreetmap.org/search?q={urllib.parse.quote(query + ', India')}&format=json&countrycodes=in&addressdetails=1&limit=6"
                nom_req = urllib.request.Request(
                    nom_url,
                    headers={"User-Agent": "CSDPondPlannerResearch/1.0 (academic-research@csd.ac.in)"}
                )
                with urllib.request.urlopen(nom_req, timeout=5) as resp:
                    nom_data = json.loads(resp.read().decode())
                    span.set_attribute("search.nominatim_raw_count", len(nom_data))
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
                span.record_exception(e)
                span.set_attribute("search.nominatim_error", str(e))

        final_results = results[:12]
        span.set_attribute("search.results_count", len(final_results))
        instruments["village_searches"].add(1, {"source": "osm", "status": "success"})
        return jsonify({"results": final_results}), 200


def _execute_hydrological_pipeline(kml_path: str, top_n: int, grid_res: int, filename: str, file_size_mb: float):
    """
    Executes the 6-stage hydrological analysis pipeline wrapped with OpenTelemetry spans
    and metrics collection.
    """
    t0 = time.time()
    instruments["active_requests"].add(1)

    with tracer.start_as_current_span("pond_analysis.pipeline") as pipeline_span:
        pipeline_span.set_attribute("input.filename", filename)
        pipeline_span.set_attribute("input.file_size_mb", file_size_mb)
        pipeline_span.set_attribute("input.top_n", top_n)
        pipeline_span.set_attribute("input.grid_res", grid_res)

        try:
            log.info(
                "Processing: %s  %.2f MB  top_n=%d  grid_res=%d",
                filename,
                file_size_mb,
                top_n,
                grid_res,
            )

            # Stage 1: Parse Contour Information
            with tracer.start_as_current_span("kml_parser.parse_contours") as stage1_span:
                stage1_span.set_attribute("kml.source_path", kml_path)
                contours = parse_kml_kmz(kml_path)
                stage1_span.set_attribute("kml.contours_count", len(contours))
                stage1_span.add_event("contours_extracted", {"count": len(contours)})

            if not contours:
                raise ValueError("No elevation contour polylines found in the provided file.")

            # Stage 2: DEM Construction
            with tracer.start_as_current_span("dem_builder.build_dem") as stage2_span:
                stage2_span.set_attribute("dem.target_resolution", grid_res)
                dem, meta = build_dem(contours, resolution=grid_res)
                stage2_span.set_attribute("dem.shape_rows", int(dem.shape[0]))
                stage2_span.set_attribute("dem.shape_cols", int(dem.shape[1]))
                stage2_span.set_attribute("dem.total_cells", int(dem.size))
                stage2_span.set_attribute("dem.min_elevation_m", float(meta.get("min_elev", 0.0)))
                stage2_span.set_attribute("dem.max_elevation_m", float(meta.get("max_elev", 0.0)))
                
                # Record DEM metric
                instruments["dem_cells"].record(dem.size, {"resolution": str(grid_res)})

            # Stage 3: Flow Routing, Accumulation & River Network Detection
            with tracer.start_as_current_span("terrain_analysis.flow_routing") as stage3_span:
                with tracer.start_as_current_span("terrain_analysis.add_perturbation"):
                    dem_pert = add_perturbation(dem)

                with tracer.start_as_current_span("terrain_analysis.compute_flow_direction"):
                    flow_dir = compute_flow_direction(dem_pert)

                with tracer.start_as_current_span("terrain_analysis.compute_flow_accumulation"):
                    flow_acc = compute_flow_accumulation(dem_pert, flow_dir)

                with tracer.start_as_current_span("terrain_analysis.detect_rivers"):
                    river_mask = detect_rivers(flow_acc, flow_dir)

                # River exclusion buffer
                from scipy.ndimage import binary_dilation
                grid_size = dem.shape[0] * dem.shape[1]
                river_excl = binary_dilation(
                    river_mask,
                    iterations=RIVER_BUFFER_CELLS,
                ).astype(bool)

                excl_frac = river_excl.sum() / grid_size
                stage3_span.set_attribute("river.detected_cells", int(river_mask.sum()))
                stage3_span.set_attribute("river.exclusion_cells", int(river_excl.sum()))
                stage3_span.set_attribute("river.exclusion_percent", round(float(excl_frac * 100), 2))

                log.info(
                    "River exclusion zone: %d / %d cells = %.1f%% of grid",
                    int(river_excl.sum()),
                    grid_size,
                    excl_frac * 100,
                )

                if excl_frac > 0.60:
                    log.warning(
                        "Exclusion zone %.1f%% > 60%% — falling back to raw river mask",
                        excl_frac * 100,
                    )
                    river_excl = river_mask
                    stage3_span.add_event("river_buffer_fallback", {"reason": "Exclusion zone > 60%"})

            # Stage 4: Catchment Delineation & Candidate Discovery
            with tracer.start_as_current_span("catchment.find_pond_candidates") as stage4_span:
                candidates = find_pond_candidates(
                    dem,
                    flow_acc,
                    river_excl,
                    meta,
                    flow_dir,
                )
                stage4_span.set_attribute("catchment.candidates_discovered", len(candidates))
                instruments["candidates_found"].add(len(candidates), {"algorithm": "d8_uphill_bfs"})

            if not candidates:
                pipeline_span.set_attribute("pipeline.candidates_found", 0)
                pipeline_span.set_status(Status(StatusCode.ERROR, "No suitable pond locations found"))
                instruments["requests_total"].add(1, {"status": "no_candidates", "file_type": "kml"})
                return {
                    "error": "No suitable pond locations found.",
                    "hint": "Try a different KML or reduce MIN_CATCHMENT_AREA_HA in config.py",
                    "n_contours": len(contours),
                }, 422

            # Stage 5: Multi-Criteria Scoring & Selection
            with tracer.start_as_current_span("pond_selector.score_and_select") as stage5_span:
                stage5_span.set_attribute("pond.top_n_requested", top_n)
                top = score_and_select(candidates, n=top_n)
                stage5_span.set_attribute("pond.selected_count", len(top))
                if top:
                    stage5_span.set_attribute("pond.best_score", float(top[0].get("score", 0.0)))
                instruments["ponds_selected"].add(len(top), {"method": "pareto_scoring"})

            # Stage 6: GeoJSON Serialization
            with tracer.start_as_current_span("geojson_builder.build_geojson") as stage6_span:
                geojson = build_geojson(top, dem, meta, contours)
                stage6_span.set_attribute("geojson.features_count", len(geojson.get("features", [])))

            duration_s = time.time() - t0
            duration_ms = round(duration_s * 1000.0, 2)

            geojson["metadata"]["processing_time_s"] = round(duration_s, 2)
            geojson["metadata"]["trace_id"] = f"{pipeline_span.get_span_context().trace_id:032x}"

            pipeline_span.set_attribute("pipeline.duration_ms", duration_ms)
            pipeline_span.set_attribute("pipeline.candidates_count", len(top))
            pipeline_span.set_attribute("pipeline.success", True)
            pipeline_span.set_status(Status(StatusCode.OK))

            # Record metrics
            ext = os.path.splitext(filename.lower())[1] or ".kml"
            instruments["duration_seconds"].record(duration_s, {"status": "success"})
            instruments["requests_total"].add(1, {"status": "success", "file_type": ext})
            telemetry_store.record_request_stat(True, duration_ms, len(candidates), len(top))

            log.info(
                "Done in %.2f s — %d candidates returned (OpenTelemetry trace_id=%s)",
                duration_s,
                len(top),
                f"{pipeline_span.get_span_context().trace_id:032x}",
            )

            return geojson, 200

        except ValueError as e:
            log.warning("Pipeline input validation error: %s", e)
            pipeline_span.record_exception(e)
            pipeline_span.set_status(Status(StatusCode.ERROR, str(e)))
            instruments["requests_total"].add(1, {"status": "validation_error", "file_type": "kml"})
            telemetry_store.record_request_stat(False, (time.time() - t0) * 1000.0, 0, 0)
            return {"error": str(e)}, 422

        except Exception as e:
            log.exception("Pipeline unexpected error: %s", e)
            pipeline_span.record_exception(e)
            pipeline_span.set_status(Status(StatusCode.ERROR, str(e)))
            instruments["requests_total"].add(1, {"status": "internal_error", "file_type": "kml"})
            telemetry_store.record_request_stat(False, (time.time() - t0) * 1000.0, 0, 0)
            return {"error": f"Internal error: {e}"}, 500

        finally:
            instruments["active_requests"].add(-1)


def _run_analysis(req):
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

    try:
        top_n = max(1, min(int(req.form.get("top_n", TOP_N)), 10))
        grid_res = max(50, min(int(req.form.get("grid_res", GRID_RESOLUTION)), 300))
    except ValueError:
        return jsonify({"error": "top_n and grid_res must be integers."}), 400

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            f.save(tmp.name)
            tmp_path = tmp.name

        result, status_code = _execute_hydrological_pipeline(
            kml_path=tmp_path,
            top_n=top_n,
            grid_res=grid_res,
            filename=f.filename,
            file_size_mb=round(mb, 2),
        )
        return jsonify(result), status_code

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except Exception:
                pass


@app.route("/analyzeContour", methods=["POST"])
def analyze_contour():
    return _run_analysis(request)


@app.route("/api/sampleRun", methods=["POST"])
def run_sample_analysis():
    """
    Convenience endpoint to trigger a complete hydrological analysis
    using the bundled sample KML (sample_data/contours_1m.kml).
    Immediately generates traces, spans, and metrics for live demonstration.
    """
    if not os.path.exists(SAMPLE_KML_PATH):
        return jsonify({"error": f"Sample KML not found at {SAMPLE_KML_PATH}"}), 404

    size_mb = os.path.getsize(SAMPLE_KML_PATH) / (1024 * 1024)
    top_n = int(request.args.get("top_n", 5))
    grid_res = int(request.args.get("grid_res", 120))

    result, status_code = _execute_hydrological_pipeline(
        kml_path=SAMPLE_KML_PATH,
        top_n=top_n,
        grid_res=grid_res,
        filename="contours_1m.kml",
        file_size_mb=round(size_mb, 2),
    )
    return jsonify(result), status_code


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    log.info("Starting CSD Pond Planning API with OpenTelemetry on port %d", port)
    app.run(host="0.0.0.0", port=port, debug=False)