"""
telemetry.py - OpenTelemetry Observability Subsystem for CSD Pond Planner

Implements the three core pillars of OpenTelemetry:
  1. Distributed Traces:
     - Automated Flask HTTP server instrumentation
     - Automated outbound HTTP instrumentation (Photon / Nominatim)
     - Custom nested pipeline spans for GIS & Hydrology processing stages:
       * KML/KMZ parsing
       * DEM raster construction & interpolation
       * Flow direction, accumulation & river network detection
       * Catchment delineation & pond candidate discovery
       * Multi-criteria scoring & pond candidate ranking
       * GeoJSON spatial serialization
     - In-memory trace store + Console exporter for live terminal inspection
  2. Metrics:
     - OpenTelemetry MeterProvider with PrometheusMetricReader
     - Standard Prometheus metrics exposed on `/metrics`
     - Custom counters, histograms, and gauges:
       * pond_analysis_requests_total
       * pond_analysis_duration_seconds
       * pond_candidates_found_total
       * pond_selected_total
       * dem_grid_cells_total
       * village_search_requests_total
       * active_processing_requests
  3. Structured Logs with Trace Correlation:
     - Automatic injection of active trace_id and span_id into logging records
     - OpenTelemetry LoggingHandler bridge for standard Python logging
     - Ring buffer of recent correlated logs for live dashboard inspection
"""

import time
import logging
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional

# OpenTelemetry Trace imports
from opentelemetry import trace
from opentelemetry.trace import StatusCode, Status
from opentelemetry.sdk.trace import TracerProvider, ReadableSpan
from opentelemetry.sdk.trace.export import SimpleSpanProcessor, ConsoleSpanExporter, SpanExporter, SpanExportResult
from opentelemetry.sdk.resources import Resource

# OpenTelemetry Metrics imports
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.exporter.prometheus import PrometheusMetricReader
import prometheus_client

# OpenTelemetry Logs imports
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import SimpleLogRecordProcessor, ConsoleLogRecordExporter

# Instrumentation packages
from opentelemetry.instrumentation.flask import FlaskInstrumentor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
from opentelemetry.instrumentation.urllib import URLLibInstrumentor


SERVICE_NAME = "csd-village-pond-planner"
SERVICE_VERSION = "1.0.0"
ENVIRONMENT = "lab-evaluation"


class InMemoryTelemetryStore:
    """
    Thread-safe in-memory store for OpenTelemetry traces, spans, metrics, and logs.
    Maintains a bounded history suitable for live inspection and VIVA demonstration.
    """
    def __init__(self, max_traces: int = 100, max_logs: int = 300):
        self._lock = threading.RLock()
        self.max_traces = max_traces
        self.max_logs = max_logs
        
        # Raw spans grouped by trace_id (hex string)
        self._traces: Dict[str, List[Dict[str, Any]]] = {}
        self._trace_order: deque = deque()  # FIFO trace_ids
        
        # Correlated logs buffer
        self._logs: deque = deque(maxlen=max_logs)
        
        # Aggregated stats
        self._stats = {
            "total_requests": 0,
            "success_requests": 0,
            "error_requests": 0,
            "total_spans_recorded": 0,
            "total_candidates_found": 0,
            "total_ponds_selected": 0,
            "last_request_time": None,
            "avg_duration_ms": 0.0,
            "_durations": deque(maxlen=50),
        }

    def record_span(self, span: ReadableSpan):
        with self._lock:
            trace_id = f"{span.context.trace_id:032x}"
            span_id = f"{span.context.span_id:016x}"
            parent_id = f"{span.parent.span_id:016x}" if span.parent else None
            
            # OpenTelemetry nanoseconds to ms
            start_ms = span.start_time / 1e6
            end_ms = (span.end_time or time.time_ns()) / 1e6
            duration_ms = max(0.01, round(end_ms - start_ms, 2))
            
            # Format attributes safely
            attrs = {}
            if span.attributes:
                for k, v in span.attributes.items():
                    if isinstance(v, (int, float, str, bool)):
                        attrs[k] = v
                    else:
                        attrs[k] = str(v)
            
            # Format events
            events = []
            if span.events:
                for ev in span.events:
                    ev_attrs = {k: (v if isinstance(v, (int, float, str, bool)) else str(v))
                                for k, v in (ev.attributes or {}).items()}
                    events.append({
                        "name": ev.name,
                        "timestamp_iso": datetime.fromtimestamp(ev.timestamp / 1e9, tz=timezone.utc).isoformat(),
                        "attributes": ev_attrs,
                    })

            span_data = {
                "name": span.name,
                "trace_id": trace_id,
                "span_id": span_id,
                "parent_id": parent_id,
                "start_time_ns": span.start_time,
                "end_time_ns": span.end_time,
                "start_time_iso": datetime.fromtimestamp(span.start_time / 1e9, tz=timezone.utc).isoformat(),
                "end_time_iso": datetime.fromtimestamp(span.end_time / 1e9, tz=timezone.utc).isoformat() if span.end_time else None,
                "duration_ms": duration_ms,
                "status": span.status.status_code.name,
                "status_description": span.status.description,
                "attributes": attrs,
                "events": events,
            }
            
            if trace_id not in self._traces:
                if len(self._trace_order) >= self.max_traces:
                    old_id = self._trace_order.popleft()
                    self._traces.pop(old_id, None)
                self._trace_order.append(trace_id)
                self._traces[trace_id] = []
            
            self._traces[trace_id].append(span_data)
            self._stats["total_spans_recorded"] += 1

    def record_log(self, log_dict: Dict[str, Any]):
        with self._lock:
            self._logs.append(log_dict)

    def record_request_stat(self, success: bool, duration_ms: float, candidates: int = 0, selected: int = 0):
        with self._lock:
            self._stats["total_requests"] += 1
            if success:
                self._stats["success_requests"] += 1
            else:
                self._stats["error_requests"] += 1
            self._stats["total_candidates_found"] += candidates
            self._stats["total_ponds_selected"] += selected
            self._stats["last_request_time"] = datetime.now(timezone.utc).isoformat()
            self._stats["_durations"].append(duration_ms)
            self._stats["avg_duration_ms"] = round(sum(self._stats["_durations"]) / len(self._stats["_durations"]), 2)

    def get_traces_list(self) -> List[Dict[str, Any]]:
        with self._lock:
            trace_summaries = []
            for tid in reversed(self._trace_order):
                spans = self._traces.get(tid, [])
                if not spans:
                    continue
                # Sort spans by start_time
                sorted_spans = sorted(spans, key=lambda s: s["start_time_ns"])
                root = next((s for s in sorted_spans if not s["parent_id"]), sorted_spans[0])
                
                trace_start_ns = sorted_spans[0]["start_time_ns"]
                trace_end_ns = max(s["end_time_ns"] or s["start_time_ns"] for s in sorted_spans)
                total_duration_ms = round((trace_end_ns - trace_start_ns) / 1e6, 2)
                
                has_error = any(s["status"] == "ERROR" for s in sorted_spans)
                
                trace_summaries.append({
                    "trace_id": tid,
                    "root_span": root["name"],
                    "spans_count": len(sorted_spans),
                    "start_time_iso": root["start_time_iso"],
                    "duration_ms": total_duration_ms,
                    "status": "ERROR" if has_error else "OK",
                    "http_method": root["attributes"].get("http.method", ""),
                    "http_route": root["attributes"].get("http.route", root["attributes"].get("http.target", "")),
                })
            return trace_summaries

    def get_trace_details(self, trace_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            spans = self._traces.get(trace_id)
            if not spans:
                return None
            
            sorted_spans = sorted(spans, key=lambda s: s["start_time_ns"])
            trace_start_ns = sorted_spans[0]["start_time_ns"]
            trace_end_ns = max(s["end_time_ns"] or s["start_time_ns"] for s in sorted_spans)
            total_duration_ms = max(0.01, round((trace_end_ns - trace_start_ns) / 1e6, 2))
            
            # Enrich with relative offsets and depth for waterfall visualizer
            span_map = {s["span_id"]: s for s in sorted_spans}
            
            def calc_depth(s_id, visited=None):
                if visited is None:
                    visited = set()
                if s_id in visited or s_id not in span_map:
                    return 0
                visited.add(s_id)
                parent_id = span_map[s_id]["parent_id"]
                if not parent_id or parent_id not in span_map:
                    return 0
                return 1 + calc_depth(parent_id, visited)
            
            waterfall_spans = []
            for s in sorted_spans:
                offset_ms = round((s["start_time_ns"] - trace_start_ns) / 1e6, 2)
                pct_start = min(100.0, max(0.0, (offset_ms / total_duration_ms) * 100))
                pct_width = min(100.0 - pct_start, max(1.0, (s["duration_ms"] / total_duration_ms) * 100))
                
                s_copy = dict(s)
                s_copy["offset_ms"] = offset_ms
                s_copy["depth"] = calc_depth(s["span_id"])
                s_copy["waterfall_pct_start"] = round(pct_start, 2)
                s_copy["waterfall_pct_width"] = round(pct_width, 2)
                waterfall_spans.append(s_copy)
            
            root = next((s for s in sorted_spans if not s["parent_id"]), sorted_spans[0])
            
            return {
                "trace_id": trace_id,
                "root_span": root["name"],
                "start_time_iso": sorted_spans[0]["start_time_iso"],
                "total_duration_ms": total_duration_ms,
                "status": "ERROR" if any(s["status"] == "ERROR" for s in sorted_spans) else "OK",
                "spans_count": len(sorted_spans),
                "spans": waterfall_spans,
            }

    def get_logs(self, limit: int = 150) -> List[Dict[str, Any]]:
        with self._lock:
            return list(reversed(list(self._logs)))[:limit]

    def get_stats(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "service_name": SERVICE_NAME,
                "service_version": SERVICE_VERSION,
                "environment": ENVIRONMENT,
                "total_traces": len(self._traces),
                "total_spans": self._stats["total_spans_recorded"],
                "total_requests": self._stats["total_requests"],
                "success_requests": self._stats["success_requests"],
                "error_requests": self._stats["error_requests"],
                "total_candidates_found": self._stats["total_candidates_found"],
                "total_ponds_selected": self._stats["total_ponds_selected"],
                "avg_duration_ms": self._stats["avg_duration_ms"],
                "last_request_time": self._stats["last_request_time"],
                "log_records_count": len(self._logs),
            }

    def clear(self):
        with self._lock:
            self._traces.clear()
            self._trace_order.clear()
            self._logs.clear()
            self._stats["total_spans_recorded"] = 0
            self._stats["_durations"].clear()
            self._stats["avg_duration_ms"] = 0.0


class InMemorySpanExporter(SpanExporter):
    """OpenTelemetry SpanExporter that feeds the TelemetryStore."""
    def __init__(self, store: InMemoryTelemetryStore):
        self.store = store

    def export(self, spans: List[ReadableSpan]) -> SpanExportResult:
        for span in spans:
            self.store.record_span(span)
        return SpanExportResult.SUCCESS

    def shutdown(self):
        pass


class TraceContextLogFilter(logging.Filter):
    """
    Standard logging Filter that extracts OpenTelemetry trace_id and span_id
    from the active execution context and injects them into LogRecords.
    """
    def filter(self, record: logging.LogRecord) -> bool:
        current_span = trace.get_current_span()
        ctx = current_span.get_span_context() if current_span else None
        if ctx and ctx.is_valid:
            record.trace_id = f"{ctx.trace_id:032x}"
            record.span_id = f"{ctx.span_id:016x}"
        else:
            record.trace_id = "00000000000000000000000000000000"
            record.span_id = "0000000000000000"
        return True


class TelemetryLogHandler(logging.Handler):
    """
    Logging handler that buffers correlated log records into the TelemetryStore.
    """
    def __init__(self, store: InMemoryTelemetryStore):
        super().__init__()
        self.store = store

    def emit(self, record: logging.LogRecord):
        try:
            trace_id = getattr(record, "trace_id", "00000000000000000000000000000000")
            span_id = getattr(record, "span_id", "0000000000000000")
            msg = self.format(record)
            
            self.store.record_log({
                "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
                "level": record.levelname,
                "logger": record.name,
                "message": record.getMessage(),
                "formatted": msg,
                "trace_id": trace_id,
                "span_id": span_id,
                "has_trace": trace_id != "00000000000000000000000000000000",
            })
        except Exception:
            self.handleError(record)


# Global instances
telemetry_store = InMemoryTelemetryStore()
_tracer: Optional[trace.Tracer] = None
_meter: Optional[metrics.Meter] = None
_prometheus_reader: Optional[PrometheusMetricReader] = None

# Metric instruments
metrics_instruments: Dict[str, Any] = {}


def setup_telemetry(app=None) -> Dict[str, Any]:
    """
    Main initialization for OpenTelemetry:
      - Sets up TracerProvider + Exporters (Console + In-Memory)
      - Sets up MeterProvider + PrometheusMetricReader
      - Sets up LoggerProvider + Log correlation
      - Instruments Flask, Requests, and URLLib
    """
    global _tracer, _meter, _prometheus_reader, metrics_instruments

    # 1. Define Service Resource
    resource = Resource.create({
        "service.name": SERVICE_NAME,
        "service.version": SERVICE_VERSION,
        "deployment.environment": ENVIRONMENT,
        "telemetry.sdk.language": "python",
    })

    # 2. Configure Tracer Provider
    tracer_provider = TracerProvider(resource=resource)
    trace.set_tracer_provider(tracer_provider)
    
    # Exporters: In-memory store for dashboard + Console exporter for CLI viva proof
    in_memory_exporter = InMemorySpanExporter(telemetry_store)
    tracer_provider.add_span_processor(SimpleSpanProcessor(in_memory_exporter))
    tracer_provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    _tracer = trace.get_tracer(SERVICE_NAME, SERVICE_VERSION)

    # 3. Configure Meter Provider with Prometheus Metric Reader
    _prometheus_reader = PrometheusMetricReader()
    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[_prometheus_reader],
    )
    metrics.set_meter_provider(meter_provider)
    _meter = metrics.get_meter(SERVICE_NAME, SERVICE_VERSION)

    # Create OpenTelemetry Metric Instruments
    metrics_instruments["requests_total"] = _meter.create_counter(
        name="pond_analysis_requests_total",
        description="Total number of pond contour analysis requests processed",
        unit="1",
    )
    metrics_instruments["duration_seconds"] = _meter.create_histogram(
        name="pond_analysis_duration_seconds",
        description="End-to-end execution latency for pond contour analysis pipeline",
        unit="s",
    )
    metrics_instruments["candidates_found"] = _meter.create_counter(
        name="pond_candidates_found_total",
        description="Total number of hydrological pond candidate sites identified",
        unit="1",
    )
    metrics_instruments["ponds_selected"] = _meter.create_counter(
        name="pond_selected_total",
        description="Total number of top pond candidate locations recommended",
        unit="1",
    )
    metrics_instruments["dem_cells"] = _meter.create_histogram(
        name="dem_grid_cells_total",
        description="Number of cells in generated DEM elevation rasters",
        unit="cells",
    )
    metrics_instruments["village_searches"] = _meter.create_counter(
        name="village_search_requests_total",
        description="Total count of village OSM / Nominatim geo-searches",
        unit="1",
    )
    metrics_instruments["active_requests"] = _meter.create_up_down_counter(
        name="pond_active_requests",
        description="Number of currently running analysis pipeline requests",
        unit="1",
    )

    # 4. Configure OpenTelemetry Logging & Correlation
    log_filter = TraceContextLogFilter()
    formatter = logging.Formatter(
        "[%(asctime)s] [%(levelname)s] [trace_id=%(trace_id)s span_id=%(span_id)s] %(name)s: %(message)s"
    )
    
    root_log = logging.getLogger()
    for h in root_log.handlers:
        h.addFilter(log_filter)
        h.setFormatter(formatter)
        
    log_handler = TelemetryLogHandler(telemetry_store)
    log_handler.addFilter(log_filter)
    log_handler.setFormatter(formatter)
    root_log.addHandler(log_handler)

    # OpenTelemetry SDK Log Bridge
    try:
        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(SimpleLogRecordProcessor(ConsoleLogRecordExporter()))
        otel_log_handler = LoggingHandler(level=logging.INFO, logger_provider=logger_provider)
        root_log.addHandler(otel_log_handler)
    except Exception as e:
        logging.getLogger(__name__).warning("OpenTelemetry LoggerProvider setup notice: %s", e)

    # 5. Outbound HTTP instrumentation (captures external Photon/Nominatim calls)
    try:
        URLLibInstrumentor().instrument()
    except Exception:
        pass
    try:
        RequestsInstrumentor().instrument()
    except Exception:
        pass

    # 6. Instrument Flask app if provided
    if app:
        FlaskInstrumentor().instrument_app(app)
        register_telemetry_routes(app)

    logging.getLogger(__name__).info("OpenTelemetry successfully initialized for service '%s'", SERVICE_NAME)
    return {
        "tracer": _tracer,
        "meter": _meter,
        "instruments": metrics_instruments,
        "store": telemetry_store,
    }


def get_tracer() -> trace.Tracer:
    global _tracer
    if _tracer is None:
        setup_telemetry()
    return _tracer


def get_meter() -> metrics.Meter:
    global _meter
    if _meter is None:
        setup_telemetry()
    return _meter


def get_instruments() -> Dict[str, Any]:
    global metrics_instruments
    if not metrics_instruments:
        setup_telemetry()
    return metrics_instruments


def get_prometheus_metrics() -> bytes:
    """Generate the latest Prometheus exposition format text."""
    return prometheus_client.generate_latest()


def register_telemetry_routes(app):
    """Registers standard OpenTelemetry inspection and dashboard routes."""
    from flask import Response, jsonify, request, send_from_directory
    import os

    @app.route("/metrics", methods=["GET"])
    def prometheus_metrics():
        data = get_prometheus_metrics()
        return Response(data, mimetype="text/plain; version=0.0.4; charset=utf-8")

    @app.route("/api/telemetry/overview", methods=["GET"])
    def telemetry_overview():
        return jsonify(telemetry_store.get_stats())

    @app.route("/api/telemetry/traces", methods=["GET"])
    def telemetry_traces():
        return jsonify({
            "traces": telemetry_store.get_traces_list(),
            "count": len(telemetry_store._traces),
        })

    @app.route("/api/telemetry/traces/<trace_id>", methods=["GET"])
    def telemetry_trace_detail(trace_id):
        details = telemetry_store.get_trace_details(trace_id)
        if not details:
            return jsonify({"error": f"Trace {trace_id} not found"}), 404
        return jsonify(details)

    @app.route("/api/telemetry/logs", methods=["GET"])
    def telemetry_logs():
        limit = int(request.args.get("limit", 150))
        return jsonify({
            "logs": telemetry_store.get_logs(limit=limit),
        })

    @app.route("/api/telemetry/clear", methods=["POST"])
    def telemetry_clear():
        telemetry_store.clear()
        return jsonify({"status": "cleared"}), 200

    @app.route("/observability", methods=["GET"])
    def serve_observability_dashboard():
        html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "frontend", "observability.html")
        if os.path.exists(html_path):
            with open(html_path, "r", encoding="utf-8") as f:
                return Response(f.read(), mimetype="text/html")
        return "Observability dashboard HTML not found", 404
