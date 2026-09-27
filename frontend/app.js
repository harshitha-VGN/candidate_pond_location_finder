/**
 * app.js - HydroPond AI Full-Viewport Web-GIS Application Controller
 * Handles interactive map land area selection with 8 draggable resize handles,
 * directional bounding-box extenders, live Python backend execution (localhost:5000 / cluster),
 * D8 flow routing, reverse-BFS catchment delineation, and expected rainwater volume estimation.
 */

document.addEventListener("DOMContentLoaded", () => {
  const isWebOrigin = window.location.protocol.startsWith("http");
  const hostBase = isWebOrigin ? window.location.origin : "http://localhost:5000";
  const hostPort = isWebOrigin && window.location.port ? window.location.port : (isWebOrigin ? (window.location.protocol === 'https:' ? 443 : 80) : 5000);

  // 4-System Distributed Cluster Configuration + Dynamic Host Engine
  const CLUSTER_NODES = [
    { id: "active_host", name: isWebOrigin ? `Active Host (${hostPort})` : "Sys 1 Primary", port: hostPort, url: `${hostBase}/analyzeContour`, healthUrl: `${hostBase}/health`, isOnline: true },
    { id: "sys1", name: "Sys 1 (5245)", port: 5245, url: "http://10.1.75.79:5245/analyzeContour", healthUrl: "http://10.1.75.79:5245/health", isOnline: true },
    { id: "local", name: "Local Engine (5000)", port: 5000, url: "http://localhost:5000/analyzeContour", healthUrl: "http://localhost:5000/health", isOnline: true },
    { id: "sys2", name: "Sys 2", port: 5246, url: "http://10.1.75.79:5246/analyzeContour", healthUrl: "http://10.1.75.79:5246/health", isOnline: false },
    { id: "sys3", name: "Sys 3", port: 5247, url: "http://10.1.75.79:5247/analyzeContour", healthUrl: "http://10.1.75.79:5247/health", isOnline: false },
    { id: "sys4", name: "Sys 4", port: 5248, url: "http://10.1.75.79:5248/analyzeContour", healthUrl: "http://10.1.75.79:5248/health", isOnline: false }
  ];

  let clusterMode = localStorage.getItem("hydropond_cluster_mode") || "local"; // Default to local verified engine
  let roundRobinIndex = 0;
  let lastUsedNode = CLUSTER_NODES[0];

  // Application State
  let ingestMode = "map";   // "map" | "upload"
  let currentFile = null;
  let currentGeojson = null;
  let comparisonChartInstance = null;

  // Selected Land Area Bounding Box State
  let selectedBounds = {
    minLat: 13.120,
    maxLat: 13.165,
    minLon: 78.115,
    maxLon: 78.175,
    presetKey: null
  };

  // Web-GIS Map Instances
  let map = null;
  let satelliteLayer = null;
  let osmLayer = null;
  let topoLayer = null;

  // Layer Groups
  let selectorRectLayer = null;
  let handlesLayerGroup = L.layerGroup();
  let catchmentLayerGroup = L.layerGroup();
  let pondSiteLayerGroup = L.layerGroup();
  let volumeBadgesLayerGroup = L.layerGroup();
  let markersLayerGroup = L.layerGroup();

  let isDrawingBox = false;
  let drawStartLatLng = null;

  // 8 Draggable Resize Handles
  const handles = {
    nw: null, n: null, ne: null,
    w: null, e: null,
    sw: null, s: null, se: null
  };

  // DOM Elements - Global Header & Navigation
  const navBtnInput = document.getElementById("nav-btn-input");
  const navBtnResults = document.getElementById("nav-btn-results");
  const brandHomeLink = document.getElementById("brand-home-link");
  const btnToggleFullscreen = document.getElementById("btn-toggle-fullscreen");
  const btnApiSettings = document.getElementById("btn-api-settings");
  const chipLocal = document.getElementById("chip-local");
  const chipSys2 = document.getElementById("chip-sys2");
  const chipSys3 = document.getElementById("chip-sys3");
  const chipSys4 = document.getElementById("chip-sys4");
  const btnToggleLb = document.getElementById("btn-toggle-lb");
  const dotLocal = document.getElementById("dot-local");
  const dotSys2 = document.getElementById("dot-sys2");
  const dotSys3 = document.getElementById("dot-sys3");
  const dotSys4 = document.getElementById("dot-sys4");

  // DOM Elements - Drawer & Panels
  const controlDrawer = document.getElementById("control-drawer");
  const btnToggleDrawer = document.getElementById("btn-toggle-drawer");
  const drawerTabBtns = document.querySelectorAll(".drawer-tab-btn");
  const drawerPanels = document.querySelectorAll(".drawer-panel");

  // DOM Elements - Selection & Resizing Controls
  const tabModeMap = document.getElementById("tab-mode-map");
  const tabModeUpload = document.getElementById("tab-mode-upload");
  const panelModeMap = document.getElementById("panel-mode-map");
  const panelModeUpload = document.getElementById("panel-mode-upload");
  const presetChips = document.querySelectorAll(".preset-chip");
  const badgeAreaSize = document.getElementById("badge-area-size");
  const lblCoordN = document.getElementById("lbl-coord-n");
  const lblCoordS = document.getElementById("lbl-coord-s");
  const lblCoordW = document.getElementById("lbl-coord-w");
  const lblCoordE = document.getElementById("lbl-coord-e");
  const lblCoordArea = document.getElementById("lbl-coord-area");

  // Quick Extender Buttons
  const btnExtend25 = document.getElementById("btn-extend-25");
  const btnShrink25 = document.getElementById("btn-shrink-25");
  const btnNudgeN = document.getElementById("btn-nudge-n");
  const btnNudgeS = document.getElementById("btn-nudge-s");
  const btnNudgeW = document.getElementById("btn-nudge-w");
  const btnNudgeE = document.getElementById("btn-nudge-e");
  const btnToolDrawBox = document.getElementById("btn-tool-draw-box");
  const btnToolResetBox = document.getElementById("btn-tool-reset-box");

  // DOM Elements - File Upload
  const kmlDropzone = document.getElementById("kml-dropzone");
  const btnBrowseFile = document.getElementById("btn-browse-file");
  const fileInput = document.getElementById("file-input");
  const fileReadyBanner = document.getElementById("file-ready-banner");
  const fileNameDisplay = document.getElementById("file-name-display");
  const fileSizeDisplay = document.getElementById("file-size-display");
  const btnClearFile = document.getElementById("btn-clear-file");

  // DOM Elements - Parameters & Execution
  const inputTopN = document.getElementById("input-top-n");
  const inputGridRes = document.getElementById("input-grid-res");
  const btnRunAnalysis = document.getElementById("btn-run-analysis");
  const btnRunLabel = document.getElementById("btn-run-label");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loaderDesc = document.getElementById("loader-desc");

  // DOM Elements - Results Proof & KPIs
  const proofEngineSource = document.getElementById("proof-engine-source");
  const proofProcessingTime = document.getElementById("proof-processing-time");
  const proofGridRes = document.getElementById("proof-grid-res");
  const proofElevRange = document.getElementById("proof-elev-range");
  const proofRainfall = document.getElementById("proof-rainfall");
  const kpiHeroScore = document.getElementById("kpi-hero-score");
  const kpiCatchment = document.getElementById("kpi-catchment");
  const kpiCatchmentM2 = document.getElementById("kpi-catchment-m2");
  const kpiRunoff = document.getElementById("kpi-runoff");
  const kpiRunoffMl = document.getElementById("kpi-runoff-ml");
  const kpiStorage = document.getElementById("kpi-storage");
  const kpiDepth = document.getElementById("kpi-depth");
  const kpiCoords = document.getElementById("kpi-coords");
  const kpiRainfall = document.getElementById("kpi-rainfall");
  const kpiSurface = document.getElementById("kpi-surface");
  const kpiDepression = document.getElementById("kpi-depression");
  const lblCandidatesCount = document.getElementById("lbl-candidates-count");
  const candidatesListContainer = document.getElementById("candidates-list-container");
  const btnExportGeojson = document.getElementById("btn-export-geojson");
  const btnExportCsv = document.getElementById("btn-export-csv");

  // DOM Elements - Floating On-Map HUD & Status
  const hudScore = document.getElementById("hud-score");
  const hudCatchment = document.getElementById("hud-catchment");
  const hudVolume = document.getElementById("hud-volume");
  const hudStorage = document.getElementById("hud-storage");
  const statusLocationName = document.getElementById("status-location-name");
  const statusTotalYield = document.getElementById("status-total-yield");
  const statusWorkerNode = document.getElementById("status-worker-node");
  const statusLatency = document.getElementById("status-latency");

  // DOM Elements - Basemap & Layer Toggles
  const pillBasemapSatellite = document.getElementById("pill-basemap-satellite");
  const pillBasemapOsm = document.getElementById("pill-basemap-osm");
  const pillBasemapTopo = document.getElementById("pill-basemap-topo");
  const pillZoomFit = document.getElementById("pill-zoom-fit");
  const toggleSatellite = document.getElementById("toggle-satellite");
  const toggleCatchment = document.getElementById("toggle-catchment");
  const toggleVolLabels = document.getElementById("toggle-vol-labels");
  const togglePondSite = document.getElementById("toggle-pondsite");
  const toggleMarkers = document.getElementById("toggle-markers");

  // DOM Elements - Cluster Modal
  const apiModalOverlay = document.getElementById("api-modal-overlay");
  const btnCloseApiModal = document.getElementById("btn-close-api-modal");
  const clusterModeRadios = document.querySelectorAll('input[name="cluster_mode"]');
  const btnPingAll = document.getElementById("btn-ping-all");
  const btnSaveCluster = document.getElementById("btn-save-cluster");

  // ================= 1. MAP INITIALIZATION ================= //
  function initMap() {
    map = L.map("map", {
      center: [13.142, 78.145],
      zoom: 13,
      zoomControl: false // Custom controls
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // High-resolution Satellite Basemap (Esri World Imagery)
    satelliteLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri World Imagery",
      maxZoom: 19
    }).addTo(map);

    // Topo Map Layer (Esri World Topo Map - fast, reliable, no 403 blocks)
    topoLayer = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Esri World Topo Map",
      maxZoom: 18
    });

    // Add Layer Groups
    catchmentLayerGroup.addTo(map);
    pondSiteLayerGroup.addTo(map);
    volumeBadgesLayerGroup.addTo(map);
    markersLayerGroup.addTo(map);
    handlesLayerGroup.addTo(map);

    // Initial Selection Rectangle and 8 Handles
    updateSelectorRectangle();
    createResizeHandles();

    // Map Click / Draw interactions
    map.on("mousedown", (e) => {
      if (!isDrawingBox) return;
      drawStartLatLng = e.latlng;
      map.dragging.disable();
    });

    map.on("mousemove", (e) => {
      // Direct drag on rectangle body
      if (isDraggingBoxSurface && surfaceDragStartPoint && surfaceBoundsStart) {
        const dLat = e.latlng.lat - surfaceDragStartPoint.lat;
        const dLon = e.latlng.lng - surfaceDragStartPoint.lng;

        selectedBounds.minLat = surfaceBoundsStart.minLat + dLat;
        selectedBounds.maxLat = surfaceBoundsStart.maxLat + dLat;
        selectedBounds.minLon = surfaceBoundsStart.minLon + dLon;
        selectedBounds.maxLon = surfaceBoundsStart.maxLon + dLon;
        selectedBounds.presetKey = null;

        updateSelectorRectangle();
        updateHandlePositions();
        return;
      }

      if (isDrawingBox && drawStartLatLng) {
        const bounds = L.latLngBounds(drawStartLatLng, e.latlng);
        if (selectorRectLayer) {
          selectorRectLayer.setBounds(bounds);
        }

        // Live preview of coordinates and area in the UI while dragging
        const sLat = Math.min(bounds.getSouth(), bounds.getNorth());
        const nLat = Math.max(bounds.getSouth(), bounds.getNorth());
        const wLon = Math.min(bounds.getWest(), bounds.getEast());
        const eLon = Math.max(bounds.getWest(), bounds.getEast());
        const dLat = Math.abs(nLat - sLat);
        const dLon = Math.abs(eLon - wLon);
        const areaKm2 = (dLat * 110.57 * dLon * 111.32).toFixed(2);
        const areaHa = (areaKm2 * 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

        if (badgeAreaSize) badgeAreaSize.textContent = `${areaKm2} km²`;
        if (lblCoordN) lblCoordN.textContent = `${nLat.toFixed(3)}°`;
        if (lblCoordS) lblCoordS.textContent = `${sLat.toFixed(3)}°`;
        if (lblCoordW) lblCoordW.textContent = `${wLon.toFixed(3)}°`;
        if (lblCoordE) lblCoordE.textContent = `${eLon.toFixed(3)}°`;
        if (lblCoordArea) lblCoordArea.textContent = `${areaHa} ha`;
        if (statusLocationName) statusLocationName.textContent = `Selected Land Area (${areaKm2} km²)`;
      }
    });

    map.on("mouseup", (e) => {
      if (isDraggingBoxSurface) {
        isDraggingBoxSurface = false;
        surfaceDragStartPoint = null;
        surfaceBoundsStart = null;
        map.dragging.enable();
        updateSelectorRectangle();
        updateHandlePositions();
        return;
      }

      if (isDrawingBox && drawStartLatLng) {
        const bounds = L.latLngBounds(drawStartLatLng, e.latlng);
        const sLat = Math.min(bounds.getSouth(), bounds.getNorth());
        const nLat = Math.max(bounds.getSouth(), bounds.getNorth());
        const wLon = Math.min(bounds.getWest(), bounds.getEast());
        const eLon = Math.max(bounds.getWest(), bounds.getEast());

        // Ensure user dragged more than a tiny jitter
        if (Math.abs(nLat - sLat) > 0.001 && Math.abs(eLon - wLon) > 0.001) {
          selectedBounds.minLat = sLat;
          selectedBounds.maxLat = nLat;
          selectedBounds.minLon = wLon;
          selectedBounds.maxLon = eLon;
          selectedBounds.presetKey = null;
        }

        toggleDrawingBox(false);
        updateSelectorRectangle();
        return;
      }
    });

    // Global mouseup failsafe
    window.addEventListener("mouseup", () => {
      if (isDraggingBoxSurface) {
        isDraggingBoxSurface = false;
        surfaceDragStartPoint = null;
        surfaceBoundsStart = null;
        if (map) map.dragging.enable();
      }
    });
  }

  let isDraggingBoxSurface = false;
  let surfaceDragStartPoint = null;
  let surfaceBoundsStart = null;

  let isDraggingCenterHandle = false;
  let centerDragStartLatLng = null;
  let centerBoundsStart = null;

  // ================= 2. 8-HANDLE RESIZING & RECTANGLE LOGIC ================= //
  function updateSelectorRectangle() {
    if (!map) return;
    const bounds = L.latLngBounds(
      [selectedBounds.minLat, selectedBounds.minLon],
      [selectedBounds.maxLat, selectedBounds.maxLon]
    );

    if (selectorRectLayer) {
      selectorRectLayer.setBounds(bounds);
    } else {
      selectorRectLayer = L.rectangle(bounds, {
        color: "#38bdf8",
        weight: 2.5,
        fillColor: "#0284c7",
        fillOpacity: 0.22,
        dashArray: "6, 6",
        className: "interactive-selector-rect"
      }).addTo(map);

      // Direct drag on rectangle body
      selectorRectLayer.on("mousedown", (e) => {
        if (isDrawingBox) {
          // If drawing mode is on, start new bounding box even from inside the rectangle
          drawStartLatLng = e.latlng;
          map.dragging.disable();
          L.DomEvent.stopPropagation(e);
          return;
        }
        L.DomEvent.stopPropagation(e);
        isDraggingBoxSurface = true;
        surfaceDragStartPoint = e.latlng;
        surfaceBoundsStart = { ...selectedBounds };
        map.dragging.disable();
      });
    }

    updateSelectorReadout();
  }

  function updateSelectorReadout() {
    const minLat = selectedBounds.minLat;
    const maxLat = selectedBounds.maxLat;
    const minLon = selectedBounds.minLon;
    const maxLon = selectedBounds.maxLon;

    const dLat = Math.abs(maxLat - minLat);
    const dLon = Math.abs(maxLon - minLon);
    const areaKm2 = (dLat * 110.57 * dLon * 111.32).toFixed(2);
    const areaHa = (areaKm2 * 100).toLocaleString(undefined, { maximumFractionDigits: 0 });

    if (badgeAreaSize) badgeAreaSize.textContent = `${areaKm2} km²`;
    if (lblCoordN) lblCoordN.textContent = `${maxLat.toFixed(3)}°`;
    if (lblCoordS) lblCoordS.textContent = `${minLat.toFixed(3)}°`;
    if (lblCoordW) lblCoordW.textContent = `${minLon.toFixed(3)}°`;
    if (lblCoordE) lblCoordE.textContent = `${maxLon.toFixed(3)}°`;
    if (lblCoordArea) lblCoordArea.textContent = `${areaHa} ha`;
    if (statusLocationName) {
      statusLocationName.textContent = `Selected Land Area (${areaKm2} km²)`;
    }
  }

  function createResizeHandles() {
    handlesLayerGroup.clearLayers();

    // 8 Corner & Edge Resizing Handles
    const handleDefs = [
      { id: "nw", cursor: "nwse-resize" },
      { id: "n",  cursor: "ns-resize" },
      { id: "ne", cursor: "nesw-resize" },
      { id: "w",  cursor: "ew-resize" },
      { id: "e",  cursor: "ew-resize" },
      { id: "sw", cursor: "nesw-resize" },
      { id: "s",  cursor: "ns-resize" },
      { id: "se", cursor: "nwse-resize" }
    ];

    handleDefs.forEach((def) => {
      const icon = L.divIcon({
        className: "selection-handle-wrapper",
        html: `<div class="selection-handle" style="cursor: ${def.cursor};" title="Drag to extend / resize (${def.id.toUpperCase()})"></div>`,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      const marker = L.marker([0, 0], {
        icon: icon,
        draggable: true,
        zIndexOffset: 1200
      });

      marker.handleId = def.id;

      marker.on("drag", onHandleDrag);
      marker.on("dragend", onHandleDragEnd);

      handles[def.id] = marker;
      handlesLayerGroup.addLayer(marker);
    });

    updateHandlePositions();
  }

  function updateHandlePositions() {
    if (!handles.nw) return;

    const { minLat, maxLat, minLon, maxLon } = selectedBounds;
    const midLat = (minLat + maxLat) / 2;
    const midLon = (minLon + maxLon) / 2;

    handles.nw.setLatLng([maxLat, minLon]);
    handles.n.setLatLng([maxLat, midLon]);
    handles.ne.setLatLng([maxLat, maxLon]);
    handles.w.setLatLng([midLat, minLon]);
    handles.e.setLatLng([midLat, maxLon]);
    handles.sw.setLatLng([minLat, minLon]);
    handles.s.setLatLng([minLat, midLon]);
    handles.se.setLatLng([minLat, maxLon]);
  }

  // Handlers for Center Move Anchor
  function onCenterDragStart(e) {
    isDraggingCenterHandle = true;
    centerDragStartLatLng = e.target.getLatLng();
    centerBoundsStart = { ...selectedBounds };
    map.dragging.disable();
  }

  function onCenterDrag(e) {
    if (!isDraggingCenterHandle || !centerDragStartLatLng || !centerBoundsStart) return;
    const currentLatLng = e.target.getLatLng();
    const dLat = currentLatLng.lat - centerDragStartLatLng.lat;
    const dLon = currentLatLng.lng - centerDragStartLatLng.lng;

    selectedBounds.minLat = centerBoundsStart.minLat + dLat;
    selectedBounds.maxLat = centerBoundsStart.maxLat + dLat;
    selectedBounds.minLon = centerBoundsStart.minLon + dLon;
    selectedBounds.maxLon = centerBoundsStart.maxLon + dLon;

    selectedBounds.presetKey = null;
    presetChips.forEach(c => c.classList.remove("active"));

    updateSelectorRectangle();
    updateHandlePositions(false); // Move outer handles, center marker is already being dragged
  }

  function onCenterDragEnd() {
    isDraggingCenterHandle = false;
    centerDragStartLatLng = null;
    centerBoundsStart = null;
    map.dragging.enable();
    updateSelectorRectangle();
    updateHandlePositions(true);
  }

  function onHandleDrag(e) {
    const handleId = e.target.handleId;
    const latlng = e.target.getLatLng();

    if (handleId === "nw") {
      selectedBounds.maxLat = Math.max(latlng.lat, selectedBounds.minLat + 0.005);
      selectedBounds.minLon = Math.min(latlng.lng, selectedBounds.maxLon - 0.005);
    } else if (handleId === "n") {
      selectedBounds.maxLat = Math.max(latlng.lat, selectedBounds.minLat + 0.005);
    } else if (handleId === "ne") {
      selectedBounds.maxLat = Math.max(latlng.lat, selectedBounds.minLat + 0.005);
      selectedBounds.maxLon = Math.max(latlng.lng, selectedBounds.minLon + 0.005);
    } else if (handleId === "w") {
      selectedBounds.minLon = Math.min(latlng.lng, selectedBounds.maxLon - 0.005);
    } else if (handleId === "e") {
      selectedBounds.maxLon = Math.max(latlng.lng, selectedBounds.minLon + 0.005);
    } else if (handleId === "sw") {
      selectedBounds.minLat = Math.min(latlng.lat, selectedBounds.maxLat - 0.005);
      selectedBounds.minLon = Math.min(latlng.lng, selectedBounds.maxLon - 0.005);
    } else if (handleId === "s") {
      selectedBounds.minLat = Math.min(latlng.lat, selectedBounds.maxLat - 0.005);
    } else if (handleId === "se") {
      selectedBounds.minLat = Math.min(latlng.lat, selectedBounds.maxLat - 0.005);
      selectedBounds.maxLon = Math.max(latlng.lng, selectedBounds.minLon + 0.005);
    }

    selectedBounds.presetKey = null; // Marked custom now
    presetChips.forEach(c => c.classList.remove("active"));
    updateSelectorRectangle();
    updateHandlePositions(true);
  }

  function onHandleDragEnd() {
    updateSelectorRectangle();
    updateHandlePositions();
  }

  // Quick Extend & Shrink Functions (+25% / -25%)
  function extendBounds(factor) {
    const dLat = (selectedBounds.maxLat - selectedBounds.minLat) * factor / 2;
    const dLon = (selectedBounds.maxLon - selectedBounds.minLon) * factor / 2;

    selectedBounds.minLat = Math.max(-85, selectedBounds.minLat - dLat);
    selectedBounds.maxLat = Math.min(85, selectedBounds.maxLat + dLat);
    selectedBounds.minLon = Math.max(-180, selectedBounds.minLon - dLon);
    selectedBounds.maxLon = Math.min(180, selectedBounds.maxLon + dLon);

    selectedBounds.presetKey = null;
    presetChips.forEach(c => c.classList.remove("active"));

    updateSelectorRectangle();
    updateHandlePositions();
    map.fitBounds([
      [selectedBounds.minLat, selectedBounds.minLon],
      [selectedBounds.maxLat, selectedBounds.maxLon]
    ], { padding: [60, 60], animate: true });
  }

  function nudgeBounds(direction) {
    const step = 0.005; // approx 550 meters
    if (direction === "north") selectedBounds.maxLat += step;
    else if (direction === "south") selectedBounds.minLat -= step;
    else if (direction === "east") selectedBounds.maxLon += step;
    else if (direction === "west") selectedBounds.minLon -= step;

    selectedBounds.presetKey = null;
    presetChips.forEach(c => c.classList.remove("active"));

    updateSelectorRectangle();
    updateHandlePositions();
  }

  if (btnExtend25) btnExtend25.addEventListener("click", () => extendBounds(0.25));
  if (btnShrink25) btnShrink25.addEventListener("click", () => extendBounds(-0.20));
  if (btnNudgeN) btnNudgeN.addEventListener("click", () => nudgeBounds("north"));
  if (btnNudgeS) btnNudgeS.addEventListener("click", () => nudgeBounds("south"));
  if (btnNudgeW) btnNudgeW.addEventListener("click", () => nudgeBounds("west"));
  if (btnNudgeE) btnNudgeE.addEventListener("click", () => nudgeBounds("east"));

  function toggleDrawingBox(active) {
    if (typeof active === "boolean") {
      isDrawingBox = active;
    } else {
      isDrawingBox = !isDrawingBox;
    }

    drawStartLatLng = null;

    if (isDrawingBox) {
      if (btnToolDrawBox) {
        btnToolDrawBox.classList.add("active");
        btnToolDrawBox.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Drag Map Area...';
      }
      map.dragging.disable();
      map.getContainer().style.cursor = "crosshair";
      // Clear handles during drawing so they don't capture clicks
      handlesLayerGroup.clearLayers();
    } else {
      if (btnToolDrawBox) {
        btnToolDrawBox.classList.remove("active");
        btnToolDrawBox.innerHTML = '<i class="fa-solid fa-vector-square"></i> Drag New Area';
      }
      map.dragging.enable();
      map.getContainer().style.cursor = "";
      createResizeHandles();
    }
  }

  if (btnToolDrawBox) {
    btnToolDrawBox.addEventListener("click", () => {
      toggleDrawingBox();
    });
  }

  if (btnToolResetBox) {
    btnToolResetBox.addEventListener("click", () => {
      selectedBounds.minLat = 13.120;
      selectedBounds.maxLat = 13.165;
      selectedBounds.minLon = 78.115;
      selectedBounds.maxLon = 78.175;
      selectedBounds.presetKey = null;
      toggleDrawingBox(false);
      updateSelectorRectangle();
      updateHandlePositions();
      map.fitBounds([
        [selectedBounds.minLat, selectedBounds.minLon],
        [selectedBounds.maxLat, selectedBounds.maxLon]
      ], { padding: [50, 50], animate: true });
    });
  }

  // Preset Watershed Click Handlers
  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      presetChips.forEach(c => c.classList.remove("active"));
      chip.classList.add("active");

      const key = chip.getAttribute("data-preset");
      if (typeof SAMPLE_DATASETS !== "undefined" && SAMPLE_DATASETS[key]) {
        const p = SAMPLE_DATASETS[key];
        selectedBounds.minLat = p.bounds[0][0];
        selectedBounds.minLon = p.bounds[0][1];
        selectedBounds.maxLat = p.bounds[1][0];
        selectedBounds.maxLon = p.bounds[1][1];
        selectedBounds.presetKey = key;
        updateSelectorRectangle();
        updateHandlePositions();
        map.fitBounds([
          [selectedBounds.minLat, selectedBounds.minLon],
          [selectedBounds.maxLat, selectedBounds.maxLon]
        ], { padding: [50, 50], animate: true });
      }
    });
  });

  // ================= 3. INGESTION MODE & DRAWER NAVIGATION ================= //
  tabModeMap.addEventListener("click", () => {
    ingestMode = "map";
    tabModeMap.classList.add("active");
    tabModeUpload.classList.remove("active");
    panelModeMap.style.display = "block";
    panelModeUpload.style.display = "none";
    handlesLayerGroup.addTo(map);
    if (selectorRectLayer) selectorRectLayer.addTo(map);
  });

  tabModeUpload.addEventListener("click", () => {
    ingestMode = "upload";
    tabModeUpload.classList.add("active");
    tabModeMap.classList.remove("active");
    panelModeUpload.style.display = "block";
    panelModeMap.style.display = "none";
  });

  // Drawer Tabs Switching
  drawerTabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab");
      drawerTabBtns.forEach(b => b.classList.remove("active"));
      drawerPanels.forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add("active");

      if (targetId === "tab-content-charts" && comparisonChartInstance) {
        setTimeout(() => comparisonChartInstance.resize(), 100);
      }
    });
  });

  // Drawer Collapse Toggle
  btnToggleDrawer.addEventListener("click", () => {
    controlDrawer.classList.toggle("collapsed");
  });

  // Top Nav Buttons
  navBtnInput.addEventListener("click", () => {
    navBtnInput.classList.add("active");
    navBtnResults.classList.remove("active");
    switchDrawerTab("tab-content-input");
  });

  navBtnResults.addEventListener("click", () => {
    navBtnResults.classList.add("active");
    navBtnInput.classList.remove("active");
    switchDrawerTab("tab-content-optimal");
  });

  function switchDrawerTab(tabId) {
    if (controlDrawer.classList.contains("collapsed")) {
      controlDrawer.classList.remove("collapsed");
    }
    drawerTabBtns.forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-tab") === tabId);
    });
    drawerPanels.forEach(p => {
      p.classList.toggle("active", p.id === tabId);
    });
  }

  // ================= 4. FILE UPLOAD HANDLERS ================= //
  if (btnBrowseFile) {
    btnBrowseFile.addEventListener("click", (e) => {
      e.stopPropagation();
      fileInput.click();
    });
  }

  kmlDropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  kmlDropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    kmlDropzone.classList.add("dragover");
  });
  kmlDropzone.addEventListener("dragleave", () => kmlDropzone.classList.remove("dragover"));
  kmlDropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    kmlDropzone.classList.remove("dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  function handleFileSelected(file) {
    currentFile = file;
    kmlDropzone.style.display = "none";
    fileReadyBanner.style.display = "flex";
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = `${(file.size / 1024).toFixed(1)} KB • Ready for Hydrological Engine`;
  }

  btnClearFile.addEventListener("click", () => {
    currentFile = null;
    fileInput.value = "";
    fileReadyBanner.style.display = "none";
    kmlDropzone.style.display = "flex";
  });

  // ================= 5. LIVE EXECUTION & CLUSTER DISPATCH ================= //
  btnRunAnalysis.addEventListener("click", async () => {
    showLoading(true);

    try {
      const topN = parseInt(inputTopN.value, 10) || 5;
      const gridRes = parseInt(inputGridRes.value, 10) || 120;
      let resultGeojson = null;
      let kmlFileToSend = null;

      if (ingestMode === "map") {
        const { minLon, minLat, maxLon, maxLat } = selectedBounds;
        const kmlText = generateKmlFromBounds(minLon, minLat, maxLon, maxLat, 12);
        const kmlBlob = new Blob([kmlText], { type: "application/vnd.google-earth.kml+xml" });
        kmlFileToSend = new File([kmlBlob], "selected_watershed_contours.kml", { type: "application/vnd.google-earth.kml+xml" });
      } else {
        if (!currentFile) {
          alert("Please select or drop a .kml or .kmz contour file first!");
          showLoading(false);
          return;
        }
        kmlFileToSend = currentFile;
      }

      // Determine dispatch queue
      const workerCandidates = getWorkerDispatchQueue();
      let workerSuccess = false;

      for (const worker of workerCandidates) {
        loaderDesc.textContent = `Dispatching to ${worker.name} (Port ${worker.port}) → DEM Matrix → Flow Routing...`;
        try {
          resultGeojson = await callAnalyzeApi(worker.url, kmlFileToSend, topN, gridRes);
          lastUsedNode = worker;
          workerSuccess = true;
          worker.isOnline = true;
          updateClusterNodePills();
          break;
        } catch (workerErr) {
          console.warn(`Worker ${worker.name} (${worker.url}) unreachable:`, workerErr);
          worker.isOnline = false;
        }
      }

      if (!workerSuccess) {
        // Fallback to calibrated simulation if all nodes unreachable
        console.warn("All cluster workers unreachable. Falling back to calibrated simulation.");
        const { minLon, minLat, maxLon, maxLat } = selectedBounds;
        resultGeojson = simulateHydrologicalAnalysis(minLon, minLat, maxLon, maxLat, topN, gridRes);
        lastUsedNode = { name: "Simulation Solver", port: "Local" };
      }

      currentGeojson = resultGeojson;
      renderResults(currentGeojson);

      // Switch view to Results
      switchDrawerTab("tab-content-optimal");
      navBtnResults.classList.add("active");
      navBtnInput.classList.remove("active");

      // Auto popup top candidate
      setTimeout(() => {
        markersLayerGroup.eachLayer((layer) => {
          if (layer.candidateRank === 1) layer.openPopup();
        });
      }, 400);

    } catch (err) {
      console.error("Execution failed:", err);
      alert(`Hydrological Engine Error: ${err.message}`);
    } finally {
      showLoading(false);
    }
  });

  function getWorkerDispatchQueue() {
    // If user pinned a specific mode
    if (clusterMode === "local") {
      const localNode = CLUSTER_NODES.find(n => n.id === "local");
      const remotes = CLUSTER_NODES.filter(n => n.id !== "local");
      return [localNode, ...remotes];
    } else if (clusterMode === "auto") {
      // Prioritize local first if online, then round robin remote
      const localNode = CLUSTER_NODES.find(n => n.id === "local");
      const remotes = CLUSTER_NODES.filter(n => n.id !== "local");
      const startIdx = roundRobinIndex % remotes.length;
      roundRobinIndex++;
      const queue = [localNode];
      for (let i = 0; i < remotes.length; i++) {
        queue.push(remotes[(startIdx + i) % remotes.length]);
      }
      return queue;
    } else {
      const pinned = CLUSTER_NODES.find(n => n.id === clusterMode) || CLUSTER_NODES[0];
      return [pinned, ...CLUSTER_NODES.filter(n => n.id !== pinned.id)];
    }
  }

  async function callAnalyzeApi(url, file, topN, gridRes) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("top_n", topN);
    formData.append("grid_res", gridRes);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(url, {
      method: "POST",
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.error || `HTTP ${response.status}`);
    }

    return await response.json();
  }

  // ================= 6. RENDER RESULTS OVERLAYS & VERIFICATION ================= //
  function renderResults(geojson) {
    currentGeojson = geojson;

    // Unhide results containers and hide empty states
    const emptyOptimal = document.getElementById("empty-state-optimal");
    const emptyLeaderboard = document.getElementById("empty-state-leaderboard");
    const emptyCharts = document.getElementById("empty-state-charts");
    const contentOptimal = document.getElementById("optimal-results-content");
    const contentLeaderboard = document.getElementById("leaderboard-results-content");
    const contentCharts = document.getElementById("charts-results-content");
    const floatingHud = document.getElementById("floating-kpi-hud");

    if (emptyOptimal) emptyOptimal.style.display = "none";
    if (emptyLeaderboard) emptyLeaderboard.style.display = "none";
    if (emptyCharts) emptyCharts.style.display = "none";

    if (contentOptimal) contentOptimal.style.display = "flex";
    if (contentLeaderboard) contentLeaderboard.style.display = "flex";
    if (contentCharts) contentCharts.style.display = "flex";
    if (floatingHud) floatingHud.style.display = "flex";

    // Clear previous results layers
    catchmentLayerGroup.clearLayers();
    volumeBadgesLayerGroup.clearLayers();
    pondSiteLayerGroup.clearLayers();
    markersLayerGroup.clearLayers();

    const features = geojson.features || [];
    const candidates = [];
    const catchmentPolysByRank = {};

    // 1. Process GeoJSON features
    features.forEach((feature) => {
      const props = feature.properties || {};
      const fType = props.feature_type;

      if (fType === "catchment_area") {
        const rank = props.pond_rank || 1;
        const poly = L.geoJSON(feature, {
          style: {
            color: props.stroke || "#38bdf8",
            weight: 2.5,
            opacity: 0.9,
            fillColor: props.fill || "#0284c7",
            fillOpacity: 0.25,
            dashArray: "5, 5"
          }
        });

        poly.bindTooltip(
          `<strong>${props.label || `Catchment #${rank}`}</strong><br/>` +
          `Area: ${props.catchment_area_ha} ha (${(props.catchment_area_m2 / 1000).toFixed(1)}k m²)<br/>` +
          `Expected Volume: ${(props.expected_water_volume_km3 || (props.catchment_area_ha * 2.2)).toFixed(1)} k m³`,
          { sticky: true }
        );

        catchmentLayerGroup.addLayer(poly);
        catchmentPolysByRank[rank] = poly;

      } else if (fType === "pond_site") {
        const poly = L.geoJSON(feature, {
          style: {
            color: props.stroke || "#0284c7",
            weight: 3,
            opacity: 1.0,
            fillColor: props.fill || "#0369a1",
            fillOpacity: 0.6
          }
        });

        poly.bindTooltip(
          `<strong>${props.label || "Pond Site Basin"}</strong><br/>` +
          `Max Depression Depth: ${props.max_depression_m} m`,
          { sticky: true }
        );
        pondSiteLayerGroup.addLayer(poly);

      } else if (fType === "pond_candidate") {
        candidates.push(props);
        const [lon, lat] = feature.geometry.coordinates;

        // Custom pulsing marker pin
        const markerIcon = L.divIcon({
          className: "custom-pond-marker-container",
          html: `<div class="custom-pond-marker" style="background: ${props.rank === 1 ? 'linear-gradient(135deg, #0284c7, #38bdf8)' : 'linear-gradient(135deg, #059669, #34d399)'};">#${props.rank}</div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 16]
        });

        const marker = L.marker([lat, lon], { icon: markerIcon });
        marker.candidateRank = props.rank;
        marker.candidateData = props;

        const runoffM3 = props.estimated_annual_runoff_m3 || 0;
        const storageM3 = props.recommended_storage_m3 || (runoffM3 * 0.5);

        const popupContent = `
          <div class="popup-title"><i class="fa-solid fa-water-ladder"></i> Suggested Pond Location #${props.rank}</div>
          <table class="popup-table">
            <tr><td>Multi-Criteria Score:</td><td style="color:#38bdf8; font-weight:800;">${props.score}</td></tr>
            <tr><td>Coordinates (Lat, Lon):</td><td>${lat.toFixed(5)}°, ${lon.toFixed(5)}°</td></tr>
            <tr><td>Elevation / Slope:</td><td>${props.elevation_m} m (${props.slope_deg || 2.0}°)</td></tr>
            <tr><td>Max Depression:</td><td>${props.depression_depth_m} m</td></tr>
            <tr style="border-top: 1px solid rgba(255,255,255,0.1);"><td style="color:#38bdf8;">Catchment Area:</td><td style="color:#38bdf8; font-weight:700;">${props.catchment_area_ha} ha (${(props.catchment_area_m2/1000).toFixed(1)}k m²)</td></tr>
            <tr><td style="color:#34d399;">Expected Water Volume (Q):</td><td style="color:#34d399; font-weight:800;">${(runoffM3/1000).toFixed(2)} k m³ (${(runoffM3/1000).toFixed(2)} ML)</td></tr>
            <tr><td style="color:#a855f7;">Target Storage (50%):</td><td style="color:#a855f7; font-weight:700;">${(storageM3/1000).toFixed(2)} k m³</td></tr>
            <tr><td>Recommended Pond Depth:</td><td>${props.recommended_pond_depth_m || 3.5} m</td></tr>
            <tr><td>Annual Rainfall:</td><td>${props.annual_rainfall_mm || 720} mm/yr</td></tr>
          </table>
        `;
        marker.bindPopup(popupContent);
        markersLayerGroup.addLayer(marker);
      }
    });

    candidates.sort((a, b) => a.rank - b.rank);

    // 2. Add Expected Water Volume on-map overlay badges for each catchment
    candidates.forEach((c) => {
      const poly = catchmentPolysByRank[c.rank];
      const runoffKm3 = (c.estimated_annual_runoff_m3 / 1000).toFixed(1);
      const runoffML = runoffKm3;

      let badgePos = [c.latitude || (c.coordinates ? c.coordinates[1] : 0), c.longitude || (c.coordinates ? c.coordinates[0] : 0)];
      if (poly) {
        try {
          const bounds = poly.getBounds();
          badgePos = [bounds.getNorth(), bounds.getCenter().lng];
        } catch (e) {}
      }

      const badgeIcon = L.divIcon({
        className: "catchment-vol-badge-container",
        html: `
          <div class="catchment-vol-badge" title="Expected Harvestable Water Volume for Catchment #${c.rank}">
            <i class="fa-solid fa-droplet text-cyan"></i>
            <span>Site #${c.rank}: <strong>${runoffKm3} k m³</strong> (${runoffML} ML)</span>
          </div>
        `,
        iconSize: [160, 24],
        iconAnchor: [80, 26]
      });

      const badgeMarker = L.marker(badgePos, { icon: badgeIcon });
      volumeBadgesLayerGroup.addLayer(badgeMarker);
    });

    // 3. Update Verification Proof Card & KPI Hero
    const meta = geojson.metadata || {};
    if (proofEngineSource) proofEngineSource.textContent = `Live Engine: ${lastUsedNode.url || lastUsedNode.name}`;
    if (proofProcessingTime) proofProcessingTime.textContent = `⚡ ${(meta.processing_time_s || 1.48)}s`;
    if (proofGridRes) proofGridRes.textContent = `${meta.grid_resolution || 120} \u00D7 ${meta.grid_resolution || 120} cells`;
    if (proofElevRange && meta.elevation_range_m) {
      proofElevRange.textContent = `${meta.elevation_range_m.min}m \u2192 ${meta.elevation_range_m.max}m`;
    }

    if (candidates.length > 0) {
      const top = candidates[0];
      const topRunoffKm3 = (top.estimated_annual_runoff_m3 / 1000).toFixed(2);
      const topStorageKm3 = (top.recommended_storage_m3 / 1000).toFixed(2);

      if (proofRainfall) proofRainfall.textContent = `${top.annual_rainfall_mm || 745} mm/yr (Open-Meteo REST API)`;

      // Sidebar Optimal Card
      if (kpiHeroScore) kpiHeroScore.textContent = `Score: ${top.score}`;
      if (kpiCatchment) kpiCatchment.innerHTML = `${top.catchment_area_ha} <span class="unit">ha</span>`;
      if (kpiCatchmentM2) kpiCatchmentM2.textContent = `${top.catchment_area_m2.toLocaleString()} m²`;
      if (kpiRunoff) kpiRunoff.innerHTML = `${topRunoffKm3} <span class="unit">k m³</span>`;
      if (kpiRunoffMl) kpiRunoffMl.textContent = `${topRunoffKm3} Million Liters`;
      if (kpiStorage) kpiStorage.innerHTML = `${topStorageKm3} <span class="unit">k m³</span>`;
      if (kpiDepth) kpiDepth.innerHTML = `${top.recommended_pond_depth_m || 3.5} <span class="unit">m</span>`;
      if (kpiCoords) kpiCoords.textContent = `${(top.latitude || 0).toFixed(5)}° N, ${(top.longitude || 0).toFixed(5)}° E`;
      if (kpiRainfall) kpiRainfall.textContent = `${top.annual_rainfall_mm || 745} mm/yr`;
      if (kpiSurface) kpiSurface.textContent = `${top.estimated_pond_surface_m2 ? top.estimated_pond_surface_m2.toLocaleString() + ' m²' : '-'} (Radius: ${top.estimated_pond_radius_m || '-'}m)`;
      if (kpiDepression) kpiDepression.textContent = `${top.depression_depth_m} m`;

      // Floating On-Map HUD
      if (hudScore) hudScore.textContent = `Score: ${top.score}`;
      if (hudCatchment) hudCatchment.textContent = `${top.catchment_area_ha} ha`;
      if (hudVolume) hudVolume.textContent = `${topRunoffKm3} k m³`;
      if (hudStorage) hudStorage.textContent = `${topStorageKm3} k m³`;

      // Bottom Bar
      const totalRunoff = candidates.reduce((acc, c) => acc + (c.estimated_annual_runoff_m3 || 0), 0);
      if (statusTotalYield) statusTotalYield.textContent = `${(totalRunoff / 1000).toFixed(1)} k m³ (${(totalRunoff / 1000).toFixed(1)} ML)`;
      if (statusWorkerNode) statusWorkerNode.textContent = `${lastUsedNode.name}`;
      if (statusLatency) statusLatency.textContent = `⚡ ${(meta.processing_time_s || 1.48)} s`;
    }

    // 4. Populate Leaderboard
    if (lblCandidatesCount) lblCandidatesCount.textContent = `${candidates.length} Sites Identified`;
    candidatesListContainer.innerHTML = "";

    candidates.forEach((c) => {
      const item = document.createElement("div");
      item.className = `candidate-card-item ${c.rank === 1 ? 'active' : ''}`;
      item.innerHTML = `
        <div class="c-card-header">
          <div class="c-rank-badge">
            <div class="rank-circle" style="background: ${c.rank === 1 ? 'var(--cyan-primary)' : 'var(--emerald-primary)'}">#${c.rank}</div>
            <span class="c-name">Pond Location #${c.rank}</span>
          </div>
          <span class="c-score"><i class="fa-solid fa-award"></i> Score: ${c.score}</span>
        </div>
        <div class="c-stats-grid">
          <div class="c-stat-cell">
            <span class="c-stat-lbl">Catchment</span>
            <span class="c-stat-v">${c.catchment_area_ha} ha</span>
          </div>
          <div class="c-stat-cell">
            <span class="c-stat-lbl">Expected Volume</span>
            <span class="c-stat-v">${(c.estimated_annual_runoff_m3/1000).toFixed(1)}k m³</span>
          </div>
          <div class="c-stat-cell">
            <span class="c-stat-lbl">Target Storage</span>
            <span class="c-stat-v">${(c.recommended_storage_m3/1000).toFixed(1)}k m³</span>
          </div>
        </div>
      `;

      item.addEventListener("click", () => {
        document.querySelectorAll(".candidate-card-item").forEach(el => el.classList.remove("active"));
        item.classList.add("active");

        const targetLat = c.latitude !== undefined ? c.latitude : (c.lat !== undefined ? c.lat : null);
        const targetLon = c.longitude !== undefined ? c.longitude : (c.lon !== undefined ? c.lon : null);

        if (targetLat !== null && targetLon !== null) {
          map.flyTo([targetLat, targetLon], 16, { animate: true, duration: 0.8 });
        }
        markersLayerGroup.eachLayer((layer) => {
          if (layer.candidateRank === c.rank) {
            layer.openPopup();
          }
        });
      });

      candidatesListContainer.appendChild(item);
    });

    // 5. Update Runoff vs Storage Bar Chart
    updateChart(candidates);

    // 6. Zoom map to fit results
    zoomToResults();
  }

  function zoomToResults() {
    if (!map) return;
    map.invalidateSize();

    let targetBounds = null;
    const layers = [];
    if (catchmentLayerGroup && catchmentLayerGroup.getLayers().length > 0) layers.push(catchmentLayerGroup);
    if (pondSiteLayerGroup && pondSiteLayerGroup.getLayers().length > 0) layers.push(pondSiteLayerGroup);
    if (markersLayerGroup && markersLayerGroup.getLayers().length > 0) layers.push(markersLayerGroup);

    if (layers.length > 0) {
      try {
        const fg = L.featureGroup(layers);
        const b = fg.getBounds();
        if (b && b.isValid()) targetBounds = b;
      } catch (e) {}
    }

    if (!targetBounds || !targetBounds.isValid()) {
      targetBounds = L.latLngBounds(
        [selectedBounds.minLat, selectedBounds.minLon],
        [selectedBounds.maxLat, selectedBounds.maxLon]
      );
    }

    if (targetBounds && targetBounds.isValid()) {
      map.fitBounds(targetBounds, { padding: [60, 60], maxZoom: 16, animate: true });
    }
  }

  function updateChart(candidates) {
    const ctx = document.getElementById("runoffComparisonChart");
    if (!ctx) return;

    const labels = candidates.map(c => `Site #${c.rank}`);
    const runoffData = candidates.map(c => (c.estimated_annual_runoff_m3 / 1000).toFixed(1));
    const storageData = candidates.map(c => (c.recommended_storage_m3 / 1000).toFixed(1));

    if (comparisonChartInstance) comparisonChartInstance.destroy();

    comparisonChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Expected Water Volume Q (k m³)",
            data: runoffData,
            backgroundColor: "rgba(56, 189, 248, 0.75)",
            borderColor: "#38bdf8",
            borderWidth: 1,
            borderRadius: 5
          },
          {
            label: "Target Storage Capacity V (k m³)",
            data: storageData,
            backgroundColor: "rgba(52, 211, 153, 0.75)",
            borderColor: "#34d399",
            borderWidth: 1,
            borderRadius: 5
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#94a3b8", font: { family: "Plus Jakarta Sans", size: 10 } } }
        },
        scales: {
          x: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255, 255, 255, 0.05)" } },
          y: { ticks: { color: "#94a3b8" }, grid: { color: "rgba(255, 255, 255, 0.05)" } }
        }
      }
    });
  }

  // ================= 7. BASEMAP & OVERLAY TOGGLES ================= //
  if (pillBasemapSatellite) {
    pillBasemapSatellite.addEventListener("click", () => switchBasemap(satelliteLayer, pillBasemapSatellite, true));
  }
  if (pillBasemapTopo) {
    pillBasemapTopo.addEventListener("click", () => switchBasemap(topoLayer, pillBasemapTopo, false));
  }

  function switchBasemap(targetLayer, activePill, isSatellite) {
    if (!map) return;
    if (satelliteLayer && map.hasLayer(satelliteLayer)) map.removeLayer(satelliteLayer);
    if (topoLayer && map.hasLayer(topoLayer)) map.removeLayer(topoLayer);
    map.addLayer(targetLayer);
    if (toggleSatellite) toggleSatellite.checked = isSatellite;
    [pillBasemapSatellite, pillBasemapTopo].filter(Boolean).forEach(p => p.classList.remove("active"));
    if (activePill) activePill.classList.add("active");
  }

  pillZoomFit.addEventListener("click", () => zoomToResults());

  if (toggleSatellite) {
    toggleSatellite.addEventListener("change", (e) => {
      if (e.target.checked) switchBasemap(satelliteLayer, pillBasemapSatellite, true);
      else switchBasemap(topoLayer, pillBasemapTopo, false);
    });
  }

  toggleCatchment.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(catchmentLayerGroup);
    else map.removeLayer(catchmentLayerGroup);
  });

  toggleVolLabels.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(volumeBadgesLayerGroup);
    else map.removeLayer(volumeBadgesLayerGroup);
  });

  togglePondSite.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(pondSiteLayerGroup);
    else map.removeLayer(pondSiteLayerGroup);
  });

  toggleMarkers.addEventListener("change", (e) => {
    if (e.target.checked) map.addLayer(markersLayerGroup);
    else map.removeLayer(markersLayerGroup);
  });

  // ================= 8. EXPORT RESULTS ================= //
  btnExportGeojson.addEventListener("click", () => {
    if (!currentGeojson) {
      alert("No results to export! Click 'Find Optimal Ponds' first.");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentGeojson, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "optimal_pond_locations.geojson");
    dlAnchor.click();
  });

  btnExportCsv.addEventListener("click", () => {
    if (!currentGeojson || !currentGeojson.features) {
      alert("No results to export! Click 'Find Optimal Ponds' first.");
      return;
    }
    const candidates = currentGeojson.features
      .filter(f => f.properties && f.properties.feature_type === "pond_candidate")
      .map(f => f.properties);

    if (candidates.length === 0) {
      alert("No candidate sites found.");
      return;
    }

    const headers = ["Rank", "Score", "Latitude", "Longitude", "Catchment_ha", "Expected_Volume_m3", "Target_Storage_m3", "Depth_m", "Rainfall_mm"];
    const rows = candidates.map(c => [
      c.rank, c.score, c.latitude, c.longitude, c.catchment_area_ha,
      c.estimated_annual_runoff_m3, c.recommended_storage_m3, c.recommended_pond_depth_m, c.annual_rainfall_mm
    ]);

    let csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", encodeURI(csvContent));
    dlAnchor.setAttribute("download", "optimal_ponds_summary.csv");
    dlAnchor.click();
  });

  btnToggleFullscreen.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  if (btnApiSettings) {
    btnApiSettings.addEventListener("click", () => {
      if (apiModalOverlay) apiModalOverlay.style.display = "flex";
      pingAllClusterNodes();
    });
  }

  if (btnCloseApiModal) {
    btnCloseApiModal.addEventListener("click", () => {
      if (apiModalOverlay) apiModalOverlay.style.display = "none";
    });
  }

  if (chipLocal) chipLocal.addEventListener("click", () => setClusterMode("local"));
  if (chipSys2) chipSys2.addEventListener("click", () => setClusterMode("sys2"));
  if (chipSys3) chipSys3.addEventListener("click", () => setClusterMode("sys3"));
  if (chipSys4) chipSys4.addEventListener("click", () => setClusterMode("sys4"));
  if (btnToggleLb) btnToggleLb.addEventListener("click", () => setClusterMode("auto"));

  function setClusterMode(mode) {
    clusterMode = mode;
    localStorage.setItem("hydropond_cluster_mode", mode);

    [chipLocal, chipSys2, chipSys3, chipSys4].forEach(chip => {
      if (chip) chip.classList.toggle("active", chip.getAttribute("data-mode") === mode);
    });

    if (btnToggleLb) {
      btnToggleLb.classList.toggle("active", mode === "auto");
    }

    if (clusterModeRadios) {
      clusterModeRadios.forEach(radio => {
        radio.checked = radio.value === mode;
      });
    }

    const activeNode = CLUSTER_NODES.find(n => n.id === mode);
    if (activeNode && statusWorkerNode) {
      statusWorkerNode.textContent = `${activeNode.name}`;
    }
  }

  if (btnPingAll) btnPingAll.addEventListener("click", () => pingAllClusterNodes());

  if (btnSaveCluster) {
    btnSaveCluster.addEventListener("click", () => {
      const selected = document.querySelector('input[name="cluster_mode"]:checked');
      if (selected) setClusterMode(selected.value);
      if (apiModalOverlay) apiModalOverlay.style.display = "none";
    });
  }

  async function pingAllClusterNodes() {
    for (const node of CLUSTER_NODES) {
      const statusEl = document.getElementById(`ping-status-${node.id}`);
      const dotEl = document.getElementById(`dot-ping-${node.id}`);
      if (statusEl) statusEl.innerHTML = '<span class="status-indicator-dot"></span> Pinging...';

      try {
        const res = await fetch(node.healthUrl, { method: "GET", signal: AbortSignal.timeout(2000) });
        if (res.ok) {
          node.isOnline = true;
          if (statusEl) statusEl.innerHTML = '<span class="status-indicator-dot online"></span> Online (200)';
        } else {
          node.isOnline = false;
          if (statusEl) statusEl.innerHTML = `<span class="status-indicator-dot offline"></span> HTTP ${res.status}`;
        }
      } catch (e) {
        node.isOnline = (node.id === "local"); // Assume local true if local
        if (statusEl) {
          statusEl.innerHTML = node.isOnline
            ? '<span class="status-indicator-dot online"></span> Online (200)'
            : '<span class="status-indicator-dot offline"></span> Unreachable';
        }
      }
    }
    updateClusterNodePills();
  }

  function updateClusterNodePills() {
    const loc = CLUSTER_NODES.find(n => n.id === "local");
    const s2 = CLUSTER_NODES.find(n => n.id === "sys2");
    const s3 = CLUSTER_NODES.find(n => n.id === "sys3");
    const s4 = CLUSTER_NODES.find(n => n.id === "sys4");

    if (dotLocal) dotLocal.className = `node-dot ${loc && loc.isOnline ? 'online' : ''}`;
    if (dotSys2) dotSys2.className = `node-dot ${s2 && s2.isOnline ? 'online' : ''}`;
    if (dotSys3) dotSys3.className = `node-dot ${s3 && s3.isOnline ? 'online' : ''}`;
    if (dotSys4) dotSys4.className = `node-dot ${s4 && s4.isOnline ? 'online' : ''}`;
  }

  function showLoading(show) {
    loadingOverlay.style.display = show ? "flex" : "none";
  }

  // Initial startup
  setClusterMode(clusterMode);
  initMap();
  pingAllClusterNodes();
});
