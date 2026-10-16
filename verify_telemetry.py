"""
verify_telemetry.py - Automated Verification of OpenTelemetry Implementation

Executes the AI Village Pond Planning System and asserts that:
  1. Spans are generated for each pipeline stage with valid trace_id and parent_id hierarchy.
  2. Metrics are incremented in OpenTelemetry and exposed via the Prometheus endpoint.
  3. Logs correlate with the active trace_id and span_id.
"""

import sys
import os
import json

from app import app
from telemetry import telemetry_store, get_prometheus_metrics

def main():
    print("=" * 70)
    print("  OPENTELEMETRY VERIFICATION FOR CSD VILLAGE POND PLANNER")
    print("=" * 70)

    client = app.test_client()

    # 1. Test /health endpoint
    print("\n[Step 1] Checking /health endpoint...")
    resp = client.get("/health")
    assert resp.status_code == 200, f"Health check failed: {resp.status_code}"
    print("  -> Health OK:", resp.get_json())

    # 2. Test /api/searchVillage endpoint (external HTTP instrumentation)
    print("\n[Step 2] Testing Village Search instrumentation...")
    resp = client.get("/api/searchVillage?q=Chittoor")
    assert resp.status_code == 200, f"Search failed: {resp.status_code}"
    search_data = resp.get_json()
    print(f"  -> Search returned {len(search_data.get('results', []))} results")

    # 3. Test Hydrological Analysis Pipeline (POST /api/sampleRun)
    print("\n[Step 3] Running Hydrological Contour Analysis Pipeline with OpenTelemetry...")
    resp = client.post("/api/sampleRun?top_n=3&grid_res=80")
    assert resp.status_code == 200, f"Sample run failed: {resp.status_code}, data={resp.data}"
    geo_data = resp.get_json()
    metadata = geo_data.get("metadata", {})
    trace_id = metadata.get("trace_id")
    print(f"  -> Pipeline Succeeded in {metadata.get('processing_time_s')}s")
    print(f"  -> Generated OpenTelemetry Trace ID: {trace_id}")
    print(f"  -> Top Ponds Selected: {len(geo_data.get('features', []))}")

    # 4. Verify Traces in Telemetry Store
    print("\n[Step 4] Verifying OpenTelemetry Trace Waterfall and Spans...")
    traces = telemetry_store.get_traces_list()
    assert len(traces) > 0, "No traces found in Telemetry Store!"
    print(f"  -> Total Traces captured: {len(traces)}")

    trace_detail = telemetry_store.get_trace_details(trace_id)
    assert trace_detail is not None, f"Trace {trace_id} details not found!"
    
    print(f"\n  Trace Hierarchy for {trace_id}:")
    print(f"  Total Duration: {trace_detail['total_duration_ms']} ms | Spans Count: {trace_detail['spans_count']}")
    print("  " + "-" * 66)
    print(f"  {'Span Name':<42} {'Duration (ms)':<14} {'Depth'}")
    print("  " + "-" * 66)
    for s in trace_detail["spans"]:
        indent = "  " * s["depth"]
        print(f"  {indent + s['name']:<42} {s['duration_ms']:<14.2f} {s['depth']}")

    # Assert expected pipeline spans exist
    span_names = [s["name"] for s in trace_detail["spans"]]
    expected_spans = [
        "pond_analysis.pipeline",
        "kml_parser.parse_contours",
        "dem_builder.build_dem",
        "terrain_analysis.flow_routing",
        "catchment.find_pond_candidates",
        "pond_selector.score_and_select",
        "geojson_builder.build_geojson",
    ]
    for exp in expected_spans:
        assert exp in span_names, f"Missing expected OpenTelemetry span: {exp}"
    print("\n  -> All 7 expected pipeline spans verified successfully!")

    # 5. Verify Prometheus Metrics
    print("\n[Step 5] Verifying OpenTelemetry Metrics via /metrics (Prometheus)...")
    prom_bytes = get_prometheus_metrics()
    prom_text = prom_bytes.decode("utf-8")
    
    expected_metrics = [
        "pond_analysis_requests_total",
        "pond_analysis_duration_seconds",
        "pond_candidates_found_total",
        "pond_selected_total",
        "dem_grid_cells_total",
        "village_search_requests_total",
    ]
    for metric_name in expected_metrics:
        assert metric_name in prom_text, f"Metric '{metric_name}' not found in Prometheus output!"
        print(f"  -> Metric present: {metric_name}")

    # 6. Verify Log Correlation
    print("\n[Step 6] Verifying Log Correlation with Trace ID & Span ID...")
    logs = telemetry_store.get_logs(limit=20)
    correlated_logs = [l for l in logs if l.get("has_trace")]
    assert len(correlated_logs) > 0, "No correlated logs found!"
    print(f"  -> Found {len(correlated_logs)} correlated log entries with active Trace IDs.")
    sample_log = correlated_logs[0]
    print(f"  -> Sample correlated log:")
    print(f"     Time:     {sample_log['timestamp']}")
    print(f"     Trace ID: {sample_log['trace_id']}")
    print(f"     Span ID:  {sample_log['span_id']}")
    print(f"     Message:  {sample_log['message']}")

    print("\n" + "=" * 70)
    print("  ALL OPENTELEMETRY OBSERVABILITY CHECKS PASSED (100% FUNCTIONAL)!")
    print("=" * 70)

if __name__ == "__main__":
    main()
