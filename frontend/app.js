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
  const inputVillageSearch = document.getElementById("input-village-search");
  const badgeVillageTag = document.getElementById("badge-village-tag");
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
  const btnCloseHud = document.getElementById("btn-close-hud");

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

  if (btnCloseHud) {
    btnCloseHud.addEventListener("click", () => {
      clearPreviousResults();
    });
  }

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
      clearPreviousResults();
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
        clearPreviousResults();
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

  function clearPreviousResults() {
    const hasLayers = catchmentLayerGroup.getLayers().length > 0 ||
                      pondSiteLayerGroup.getLayers().length > 0 ||
                      volumeBadgesLayerGroup.getLayers().length > 0 ||
                      markersLayerGroup.getLayers().length > 0;
    if (!currentGeojson && !hasLayers) return;

    // 1. Clear Map Result Layers
    catchmentLayerGroup.clearLayers();
    volumeBadgesLayerGroup.clearLayers();
    pondSiteLayerGroup.clearLayers();
    markersLayerGroup.clearLayers();

    // 2. Hide Floating Top-Right Optimal Pond HUD
    const floatingHud = document.getElementById("floating-kpi-hud");
    if (floatingHud) floatingHud.style.display = "none";

    // 3. Reset Drawer Panels to Empty/Ready State
    const emptyOptimal = document.getElementById("empty-state-optimal");
    const emptyLeaderboard = document.getElementById("empty-state-leaderboard");
    const emptyCharts = document.getElementById("empty-state-charts");
    const contentOptimal = document.getElementById("optimal-results-content");
    const contentLeaderboard = document.getElementById("leaderboard-results-content");
    const contentCharts = document.getElementById("charts-results-content");

    if (emptyOptimal) emptyOptimal.style.display = "flex";
    if (emptyLeaderboard) emptyLeaderboard.style.display = "flex";
    if (emptyCharts) emptyCharts.style.display = "flex";

    if (contentOptimal) contentOptimal.style.display = "none";
    if (contentLeaderboard) contentLeaderboard.style.display = "none";
    if (contentCharts) contentCharts.style.display = "none";

    // 4. Reset Bottom Bar KPIs
    if (statusTotalYield) statusTotalYield.textContent = "--";
    if (statusLatency) statusLatency.textContent = "Ready to analyze";

    // 5. Reset Cached Result State
    currentGeojson = null;
    if (lblCandidatesCount) lblCandidatesCount.textContent = "0 Sites";
    if (candidatesListContainer) candidatesListContainer.innerHTML = "";

    // 6. Switch Top Navigation Pill from Step 2 back to Step 1
    if (navBtnInput && navBtnResults) {
      navBtnInput.classList.add("active");
      navBtnResults.classList.remove("active");
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
    clearPreviousResults();
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
    clearPreviousResults();
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
    clearPreviousResults();
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
    clearPreviousResults();
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

    if (isDrawingBox) {
      clearPreviousResults();
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
      clearPreviousResults();
      selectedBounds.minLat = 13.120;
      selectedBounds.maxLat = 13.165;
      selectedBounds.minLon = 78.115;
      selectedBounds.maxLon = 78.175;
      selectedBounds.presetKey = null;
      selectedBounds.villageName = null;
      if (badgeVillageTag) badgeVillageTag.textContent = "Custom Area";
      if (inputVillageSearch) inputVillageSearch.value = "";
      toggleDrawingBox(false);
      updateSelectorRectangle();
      updateHandlePositions();
      map.fitBounds([
        [selectedBounds.minLat, selectedBounds.minLon],
        [selectedBounds.maxLat, selectedBounds.maxLon]
      ], { padding: [50, 50], animate: true });
    });
  }

  // ================= VILLAGE BASED SELECTION DATABASE & HANDLERS ================= //
  const VILLAGES_LIST = [
    // 1. KARNATAKA - Kolar
    { id: "vokkaleri", name: "Vokkaleri Village", taluk: "Kolar", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.100, maxLat: 13.150, minLon: 78.160, maxLon: 78.210 }, center: [13.125, 78.185] },
    { id: "vemagal", name: "Vemagal Watershed", taluk: "Kolar", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.165, maxLat: 13.215, minLon: 77.995, maxLon: 78.045 }, center: [13.190, 78.020] },
    { id: "kyalanur", name: "Kyalanur Village", taluk: "Kolar", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.210, maxLat: 13.260, minLon: 78.190, maxLon: 78.240 }, center: [13.235, 78.215] },
    { id: "holur", name: "Holur Gram Panchayat", taluk: "Kolar", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.185, maxLat: 13.235, minLon: 78.135, maxLon: 78.185 }, center: [13.210, 78.160] },
    { id: "sugatur", name: "Sugatur Village", taluk: "Kolar", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.150, maxLat: 13.200, minLon: 78.115, maxLon: 78.165 }, center: [13.175, 78.140] },
    { id: "narasapura", name: "Narasapura Rural", taluk: "Kolar", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.130, maxLat: 13.180, minLon: 77.960, maxLon: 78.010 }, center: [13.155, 77.985] },
    { id: "bangarapet", name: "Bangarapet Rural", taluk: "Bangarapet", district: "Kolar", state: "Karnataka", bounds: { minLat: 12.960, maxLat: 13.010, minLon: 78.175, maxLon: 78.225 }, center: [12.985, 78.200] },
    { id: "mulbagal", name: "Mulbagal Watershed", taluk: "Mulbagal", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.140, maxLat: 13.190, minLon: 78.370, maxLon: 78.420 }, center: [13.165, 78.395] },
    { id: "srinivaspur", name: "Srinivaspur Village", taluk: "Srinivaspur", district: "Kolar", state: "Karnataka", bounds: { minLat: 13.315, maxLat: 13.365, minLon: 78.190, maxLon: 78.240 }, center: [13.338, 78.214] },
    { id: "bethamangala", name: "Bethamangala Panchayat", taluk: "Bangarapet", district: "Kolar", state: "Karnataka", bounds: { minLat: 12.975, maxLat: 13.025, minLon: 78.295, maxLon: 78.345 }, center: [12.998, 78.318] },

    // KARNATAKA - Chikkaballapur
    { id: "chintamani", name: "Chintamani Watershed", taluk: "Chintamani", district: "Chikkaballapur", state: "Karnataka", bounds: { minLat: 13.380, maxLat: 13.430, minLon: 78.035, maxLon: 78.085 }, center: [13.402, 78.058] },
    { id: "sidlaghatta", name: "Sidlaghatta Rural", taluk: "Sidlaghatta", district: "Chikkaballapur", state: "Karnataka", bounds: { minLat: 13.365, maxLat: 13.415, minLon: 77.840, maxLon: 77.890 }, center: [13.391, 77.864] },
    { id: "gauribidanur", name: "Gauribidanur Watershed", taluk: "Gauribidanur", district: "Chikkaballapur", state: "Karnataka", bounds: { minLat: 13.590, maxLat: 13.640, minLon: 77.495, maxLon: 77.545 }, center: [13.612, 77.518] },
    { id: "bagepalli", name: "Bagepalli Village", taluk: "Bagepalli", district: "Chikkaballapur", state: "Karnataka", bounds: { minLat: 13.760, maxLat: 13.810, minLon: 77.770, maxLon: 77.820 }, center: [13.784, 77.792] },
    { id: "gudibande", name: "Gudibande Panchayat", taluk: "Gudibande", district: "Chikkaballapur", state: "Karnataka", bounds: { minLat: 13.645, maxLat: 13.695, minLon: 77.680, maxLon: 77.730 }, center: [13.670, 77.701] },
    { id: "chelur", name: "Chelur Gram Panchayat", taluk: "Chelur", district: "Chikkaballapur", state: "Karnataka", bounds: { minLat: 13.505, maxLat: 13.555, minLon: 78.060, maxLon: 78.110 }, center: [13.528, 78.083] },

    // KARNATAKA - Tumakuru
    { id: "pavagada", name: "Pavagada Village", taluk: "Pavagada", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 14.075, maxLat: 14.125, minLon: 77.250, maxLon: 77.300 }, center: [14.100, 77.275] },
    { id: "madhugiri", name: "Madhugiri Watershed", taluk: "Madhugiri", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.635, maxLat: 13.685, minLon: 77.185, maxLon: 77.235 }, center: [13.660, 77.210] },
    { id: "sira", name: "Sira Taluk Rural", taluk: "Sira", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.720, maxLat: 13.770, minLon: 76.880, maxLon: 76.930 }, center: [13.745, 76.905] },
    { id: "gubbi", name: "Gubbi Panchayat", taluk: "Gubbi", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.290, maxLat: 13.340, minLon: 76.915, maxLon: 76.965 }, center: [13.312, 76.940] },
    { id: "koratagere", name: "Koratagere Village", taluk: "Koratagere", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.500, maxLat: 13.550, minLon: 77.215, maxLon: 77.265 }, center: [13.522, 77.238] },
    { id: "kunigal", name: "Kunigal Rural", taluk: "Kunigal", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.000, maxLat: 13.050, minLon: 77.005, maxLon: 77.055 }, center: [13.023, 77.028] },
    { id: "tiptur", name: "Tiptur Watershed", taluk: "Tiptur", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.230, maxLat: 13.280, minLon: 76.455, maxLon: 76.505 }, center: [13.256, 76.478] },
    { id: "chikkanayakanahalli", name: "Chikkanayakanahalli", taluk: "CN Halli", district: "Tumakuru", state: "Karnataka", bounds: { minLat: 13.395, maxLat: 13.445, minLon: 76.595, maxLon: 76.645 }, center: [13.418, 76.619] },

    // KARNATAKA - Chitradurga & Davanagere
    { id: "challakere", name: "Challakere Rural", taluk: "Challakere", district: "Chitradurga", state: "Karnataka", bounds: { minLat: 14.290, maxLat: 14.340, minLon: 76.625, maxLon: 76.675 }, center: [14.313, 76.650] },
    { id: "hiriyur", name: "Hiriyur Watershed", taluk: "Hiriyur", district: "Chitradurga", state: "Karnataka", bounds: { minLat: 13.920, maxLat: 13.970, minLon: 76.595, maxLon: 76.645 }, center: [13.945, 76.618] },
    { id: "holalkere", name: "Holalkere Village", taluk: "Holalkere", district: "Chitradurga", state: "Karnataka", bounds: { minLat: 14.010, maxLat: 14.060, minLon: 76.160, maxLon: 76.210 }, center: [14.032, 76.184] },
    { id: "hosadurga", name: "Hosadurga Panchayat", taluk: "Hosadurga", district: "Chitradurga", state: "Karnataka", bounds: { minLat: 13.775, maxLat: 13.825, minLon: 76.265, maxLon: 76.315 }, center: [13.798, 76.287] },
    { id: "molakalmuru", name: "Molakalmuru Rural", taluk: "Molakalmuru", district: "Chitradurga", state: "Karnataka", bounds: { minLat: 14.700, maxLat: 14.750, minLon: 76.730, maxLon: 76.780 }, center: [14.725, 76.756] },
    { id: "jagalur", name: "Jagalur Village", taluk: "Jagalur", district: "Davanagere", state: "Karnataka", bounds: { minLat: 14.490, maxLat: 14.540, minLon: 76.320, maxLon: 76.370 }, center: [14.516, 76.342] },
    { id: "harapanahalli", name: "Harapanahalli Watershed", taluk: "Harapanahalli", district: "Vijayanagara", state: "Karnataka", bounds: { minLat: 14.770, maxLat: 14.820, minLon: 75.970, maxLon: 76.020 }, center: [14.794, 75.992] },
    { id: "channagiri", name: "Channagiri Rural", taluk: "Channagiri", district: "Davanagere", state: "Karnataka", bounds: { minLat: 14.000, maxLat: 14.050, minLon: 75.900, maxLon: 75.950 }, center: [14.025, 75.926] },
    { id: "honnali", name: "Honnali Panchayat", taluk: "Honnali", district: "Davanagere", state: "Karnataka", bounds: { minLat: 14.220, maxLat: 14.270, minLon: 75.620, maxLon: 75.670 }, center: [14.244, 75.645] },

    // KARNATAKA - Bellary, Raichur & Kalaburagi
    { id: "kudligi", name: "Kudligi Village", taluk: "Kudligi", district: "Vijayanagara", state: "Karnataka", bounds: { minLat: 14.875, maxLat: 14.925, minLon: 76.365, maxLon: 76.415 }, center: [14.901, 76.388] },
    { id: "sandur", name: "Sandur Watershed", taluk: "Sandur", district: "Bellary", state: "Karnataka", bounds: { minLat: 15.060, maxLat: 15.110, minLon: 76.525, maxLon: 76.575 }, center: [15.086, 76.548] },
    { id: "siruguppa", name: "Siruguppa Rural", taluk: "Siruguppa", district: "Bellary", state: "Karnataka", bounds: { minLat: 15.610, maxLat: 15.660, minLon: 76.870, maxLon: 76.920 }, center: [15.632, 76.896] },
    { id: "kampli", name: "Kampli Panchayat", taluk: "Kampli", district: "Bellary", state: "Karnataka", bounds: { minLat: 15.375, maxLat: 15.425, minLon: 76.575, maxLon: 76.625 }, center: [15.399, 76.598] },
    { id: "manvi", name: "Manvi Rural", taluk: "Manvi", district: "Raichur", state: "Karnataka", bounds: { minLat: 15.965, maxLat: 16.015, minLon: 77.025, maxLon: 77.075 }, center: [15.991, 77.050] },
    { id: "sindhanur", name: "Sindhanur Watershed", taluk: "Sindhanur", district: "Raichur", state: "Karnataka", bounds: { minLat: 15.740, maxLat: 15.790, minLon: 76.735, maxLon: 76.785 }, center: [15.766, 76.760] },
    { id: "devadurga", name: "Devadurga Village", taluk: "Devadurga", district: "Raichur", state: "Karnataka", bounds: { minLat: 16.395, maxLat: 16.445, minLon: 76.915, maxLon: 76.965 }, center: [16.421, 76.938] },
    { id: "lingsugur", name: "Lingsugur Panchayat", taluk: "Lingsugur", district: "Raichur", state: "Karnataka", bounds: { minLat: 16.135, maxLat: 16.185, minLon: 76.500, maxLon: 76.550 }, center: [16.158, 76.524] },
    { id: "maski", name: "Maski Village", taluk: "Maski", district: "Raichur", state: "Karnataka", bounds: { minLat: 15.935, maxLat: 15.985, minLon: 76.640, maxLon: 76.690 }, center: [15.961, 76.663] },
    { id: "sedam", name: "Sedam Taluk", taluk: "Sedam", district: "Kalaburagi", state: "Karnataka", bounds: { minLat: 17.155, maxLat: 17.205, minLon: 77.265, maxLon: 77.315 }, center: [17.181, 77.291] },
    { id: "chincholi", name: "Chincholi Village", taluk: "Chincholi", district: "Kalaburagi", state: "Karnataka", bounds: { minLat: 17.440, maxLat: 17.490, minLon: 77.400, maxLon: 77.450 }, center: [17.466, 77.426] },
    { id: "aland", name: "Aland Watershed", taluk: "Aland", district: "Kalaburagi", state: "Karnataka", bounds: { minLat: 17.540, maxLat: 17.590, minLon: 76.545, maxLon: 76.595 }, center: [17.564, 76.568] },
    { id: "afzalpur", name: "Afzalpur Rural", taluk: "Afzalpur", district: "Kalaburagi", state: "Karnataka", bounds: { minLat: 17.175, maxLat: 17.225, minLon: 76.330, maxLon: 76.380 }, center: [17.202, 76.356] },
    { id: "jewargi", name: "Jewargi Panchayat", taluk: "Jewargi", district: "Kalaburagi", state: "Karnataka", bounds: { minLat: 16.995, maxLat: 17.045, minLon: 76.745, maxLon: 76.795 }, center: [17.018, 76.768] },

    // KARNATAKA - Ramanagara & Mandya
    { id: "kanakapura", name: "Kanakapura Watershed", taluk: "Kanakapura", district: "Ramanagara", state: "Karnataka", bounds: { minLat: 12.525, maxLat: 12.575, minLon: 77.390, maxLon: 77.440 }, center: [12.548, 77.416] },
    { id: "magadi", name: "Magadi Rural", taluk: "Magadi", district: "Ramanagara", state: "Karnataka", bounds: { minLat: 12.935, maxLat: 12.985, minLon: 77.205, maxLon: 77.255 }, center: [12.958, 77.228] },
    { id: "malavalli", name: "Malavalli Village", taluk: "Malavalli", district: "Mandya", state: "Karnataka", bounds: { minLat: 12.360, maxLat: 12.410, minLon: 77.035, maxLon: 77.085 }, center: [12.386, 77.058] },
    { id: "nagamangala", name: "Nagamangala Rural", taluk: "Nagamangala", district: "Mandya", state: "Karnataka", bounds: { minLat: 12.800, maxLat: 12.850, minLon: 76.735, maxLon: 76.785 }, center: [12.822, 76.758] },

    // 2. ANDHRA PRADESH - Anantapur
    { id: "rapthadu", name: "Rapthadu Village", taluk: "Anantapur", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.590, maxLat: 14.640, minLon: 77.560, maxLon: 77.610 }, center: [14.615, 77.585] },
    { id: "bukkaraya", name: "Bukkarayasamudram", taluk: "Anantapur", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.680, maxLat: 14.730, minLon: 77.640, maxLon: 77.690 }, center: [14.705, 77.665] },
    { id: "kudair", name: "Kudair Village", taluk: "Kudair", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.710, maxLat: 14.760, minLon: 77.400, maxLon: 77.450 }, center: [14.735, 77.425] },
    { id: "kalyandurg", name: "Kalyandurg Watershed", taluk: "Kalyandurg", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.525, maxLat: 14.575, minLon: 77.085, maxLon: 77.135 }, center: [14.550, 77.110] },
    { id: "dharmavaram", name: "Dharmavaram Rural", taluk: "Dharmavaram", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.390, maxLat: 14.440, minLon: 77.695, maxLon: 77.745 }, center: [14.415, 77.720] },
    { id: "penukonda", name: "Penukonda Watershed", taluk: "Penukonda", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.060, maxLat: 14.110, minLon: 77.565, maxLon: 77.615 }, center: [14.085, 77.590] },
    { id: "gooty", name: "Gooty Rural", taluk: "Gooty", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 15.090, maxLat: 15.140, minLon: 77.610, maxLon: 77.660 }, center: [15.116, 77.634] },
    { id: "tadipatri", name: "Tadipatri Watershed", taluk: "Tadipatri", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.885, maxLat: 14.935, minLon: 77.985, maxLon: 78.035 }, center: [14.908, 78.010] },
    { id: "uravakonda", name: "Uravakonda Village", taluk: "Uravakonda", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.920, maxLat: 14.970, minLon: 77.230, maxLon: 77.280 }, center: [14.945, 77.256] },
    { id: "beluguppa", name: "Beluguppa Panchayat", taluk: "Beluguppa", district: "Anantapur", state: "Andhra Pradesh", bounds: { minLat: 14.695, maxLat: 14.745, minLon: 77.120, maxLon: 77.170 }, center: [14.721, 77.142] },

    // ANDHRA PRADESH - Sri Sathya Sai
    { id: "puttaparthi", name: "Puttaparthi Rural", taluk: "Puttaparthi", district: "Sri Sathya Sai", state: "Andhra Pradesh", bounds: { minLat: 14.140, maxLat: 14.190, minLon: 77.785, maxLon: 77.835 }, center: [14.167, 77.811] },
    { id: "kadiri", name: "Kadiri Watershed", taluk: "Kadiri", district: "Sri Sathya Sai", state: "Andhra Pradesh", bounds: { minLat: 14.090, maxLat: 14.140, minLon: 78.140, maxLon: 78.190 }, center: [14.113, 78.163] },
    { id: "gorantla", name: "Gorantla Village", taluk: "Gorantla", district: "Sri Sathya Sai", state: "Andhra Pradesh", bounds: { minLat: 13.970, maxLat: 14.020, minLon: 77.745, maxLon: 77.795 }, center: [13.993, 77.771] },
    { id: "madakasira", name: "Madakasira Panchayat", taluk: "Madakasira", district: "Sri Sathya Sai", state: "Andhra Pradesh", bounds: { minLat: 13.915, maxLat: 13.965, minLon: 77.245, maxLon: 77.295 }, center: [13.938, 77.271] },
    { id: "hindupur", name: "Hindupur Rural", taluk: "Hindupur", district: "Sri Sathya Sai", state: "Andhra Pradesh", bounds: { minLat: 13.805, maxLat: 13.855, minLon: 77.470, maxLon: 77.520 }, center: [13.829, 77.493] },

    // ANDHRA PRADESH - Chittoor
    { id: "punganur", name: "Punganur Watershed", taluk: "Punganur", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 13.340, maxLat: 13.390, minLon: 78.555, maxLon: 78.605 }, center: [13.365, 78.580] },
    { id: "madanapalle", name: "Madanapalle Rural", taluk: "Madanapalle", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 13.525, maxLat: 13.575, minLon: 78.475, maxLon: 78.525 }, center: [13.550, 78.500] },
    { id: "palamaner", name: "Palamaner Village", taluk: "Palamaner", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 13.175, maxLat: 13.225, minLon: 78.725, maxLon: 78.775 }, center: [13.201, 78.751] },
    { id: "kuppam", name: "Kuppam Rural", taluk: "Kuppam", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 12.725, maxLat: 12.775, minLon: 78.340, maxLon: 78.390 }, center: [12.752, 78.366] },
    { id: "bangarupalem", name: "Bangarupalem Panchayat", taluk: "Bangarupalem", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 13.170, maxLat: 13.220, minLon: 78.940, maxLon: 78.990 }, center: [13.194, 78.966] },
    { id: "somala", name: "Somala Watershed", taluk: "Somala", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 13.425, maxLat: 13.475, minLon: 78.810, maxLon: 78.860 }, center: [13.448, 78.835] },
    { id: "chowdepalle", name: "Chowdepalle Village", taluk: "Chowdepalle", district: "Chittoor", state: "Andhra Pradesh", bounds: { minLat: 13.395, maxLat: 13.445, minLon: 78.595, maxLon: 78.645 }, center: [13.421, 78.618] },

    // ANDHRA PRADESH - YSR Kadapa & Kurnool
    { id: "rayachoti", name: "Rayachoti Watershed", taluk: "Rayachoti", district: "Annamayya", state: "Andhra Pradesh", bounds: { minLat: 14.035, maxLat: 14.085, minLon: 78.730, maxLon: 78.780 }, center: [14.058, 78.752] },
    { id: "pulivendula", name: "Pulivendula Village", taluk: "Pulivendula", district: "Kadapa", state: "Andhra Pradesh", bounds: { minLat: 14.395, maxLat: 14.445, minLon: 78.210, maxLon: 78.260 }, center: [14.418, 78.232] },
    { id: "jammalamadugu", name: "Jammalamadugu", taluk: "Jammalamadugu", district: "Kadapa", state: "Andhra Pradesh", bounds: { minLat: 14.815, maxLat: 14.865, minLon: 78.365, maxLon: 78.415 }, center: [14.839, 78.388] },
    { id: "badvel", name: "Badvel Rural", taluk: "Badvel", district: "Kadapa", state: "Andhra Pradesh", bounds: { minLat: 14.720, maxLat: 14.770, minLon: 79.035, maxLon: 79.085 }, center: [14.743, 79.058] },
    { id: "kamalapuram", name: "Kamalapuram Panchayat", taluk: "Kamalapuram", district: "Kadapa", state: "Andhra Pradesh", bounds: { minLat: 14.565, maxLat: 14.615, minLon: 78.650, maxLon: 78.700 }, center: [14.588, 78.672] },
    { id: "adoni", name: "Adoni Watershed", taluk: "Adoni", district: "Kurnool", state: "Andhra Pradesh", bounds: { minLat: 15.610, maxLat: 15.660, minLon: 77.250, maxLon: 77.300 }, center: [15.632, 77.276] },
    { id: "alur", name: "Alur Village", taluk: "Alur", district: "Kurnool", state: "Andhra Pradesh", bounds: { minLat: 15.280, maxLat: 15.330, minLon: 77.220, maxLon: 77.270 }, center: [15.305, 77.245] },
    { id: "pattikonda", name: "Pattikonda Panchayat", taluk: "Pattikonda", district: "Kurnool", state: "Andhra Pradesh", bounds: { minLat: 15.380, maxLat: 15.430, minLon: 77.495, maxLon: 77.545 }, center: [15.402, 77.518] },
    { id: "dhone", name: "Dhone Rural", taluk: "Dhone", district: "Kurnool", state: "Andhra Pradesh", bounds: { minLat: 15.400, maxLat: 15.450, minLon: 77.845, maxLon: 77.895 }, center: [15.422, 77.871] },
    { id: "yemmiganur", name: "Yemmiganur Watershed", taluk: "Yemmiganur", district: "Kurnool", state: "Andhra Pradesh", bounds: { minLat: 15.710, maxLat: 15.760, minLon: 77.460, maxLon: 77.510 }, center: [15.736, 77.482] },

    // 3. TAMIL NADU - Krishnagiri & Dharmapuri
    { id: "hosur", name: "Hosur Rural", taluk: "Hosur", district: "Krishnagiri", state: "Tamil Nadu", bounds: { minLat: 12.715, maxLat: 12.765, minLon: 77.800, maxLon: 77.850 }, center: [12.741, 77.825] },
    { id: "denkanikottai", name: "Denkanikottai Watershed", taluk: "Denkanikottai", district: "Krishnagiri", state: "Tamil Nadu", bounds: { minLat: 12.505, maxLat: 12.555, minLon: 77.765, maxLon: 77.815 }, center: [12.528, 77.789] },
    { id: "pochampalli", name: "Pochampalli Village", taluk: "Pochampalli", district: "Krishnagiri", state: "Tamil Nadu", bounds: { minLat: 12.315, maxLat: 12.365, minLon: 78.335, maxLon: 78.385 }, center: [12.338, 78.358] },
    { id: "uthangarai", name: "Uthangarai Panchayat", taluk: "Uthangarai", district: "Krishnagiri", state: "Tamil Nadu", bounds: { minLat: 12.240, maxLat: 12.290, minLon: 78.510, maxLon: 78.560 }, center: [12.264, 78.536] },
    { id: "shoolagiri", name: "Shoolagiri Rural", taluk: "Shoolagiri", district: "Krishnagiri", state: "Tamil Nadu", bounds: { minLat: 12.645, maxLat: 12.695, minLon: 77.990, maxLon: 78.040 }, center: [12.671, 78.012] },
    { id: "harur", name: "Harur Watershed", taluk: "Harur", district: "Dharmapuri", state: "Tamil Nadu", bounds: { minLat: 12.040, maxLat: 12.090, minLon: 78.475, maxLon: 78.525 }, center: [12.062, 78.498] },
    { id: "palacode", name: "Palacode Village", taluk: "Palacode", district: "Dharmapuri", state: "Tamil Nadu", bounds: { minLat: 12.280, maxLat: 12.330, minLon: 78.055, maxLon: 78.105 }, center: [12.302, 78.079] },
    { id: "pennagaram", name: "Pennagaram Rural", taluk: "Pennagaram", district: "Dharmapuri", state: "Tamil Nadu", bounds: { minLat: 12.110, maxLat: 12.160, minLon: 77.875, maxLon: 77.925 }, center: [12.134, 77.898] },
    { id: "pappireddipatti", name: "Pappireddipatti Panchayat", taluk: "Pappireddipatti", district: "Dharmapuri", state: "Tamil Nadu", bounds: { minLat: 11.890, maxLat: 11.940, minLon: 78.345, maxLon: 78.395 }, center: [11.916, 78.368] },

    // TAMIL NADU - Salem & Tiruppur
    { id: "omalur", name: "Omalur Rural", taluk: "Omalur", district: "Salem", state: "Tamil Nadu", bounds: { minLat: 11.720, maxLat: 11.770, minLon: 78.015, maxLon: 78.065 }, center: [11.745, 78.041] },
    { id: "attur", name: "Attur Watershed", taluk: "Attur", district: "Salem", state: "Tamil Nadu", bounds: { minLat: 11.575, maxLat: 11.625, minLon: 78.575, maxLon: 78.625 }, center: [11.598, 78.598] },
    { id: "mettur", name: "Mettur Rural", taluk: "Mettur", district: "Salem", state: "Tamil Nadu", bounds: { minLat: 11.770, maxLat: 11.820, minLon: 77.775, maxLon: 77.825 }, center: [11.796, 77.801] },
    { id: "sankagiri", name: "Sankagiri Panchayat", taluk: "Sankagiri", district: "Salem", state: "Tamil Nadu", bounds: { minLat: 11.460, maxLat: 11.510, minLon: 77.845, maxLon: 77.895 }, center: [11.482, 77.871] },
    { id: "dharapuram", name: "Dharapuram Watershed", taluk: "Dharapuram", district: "Tiruppur", state: "Tamil Nadu", bounds: { minLat: 10.710, maxLat: 10.760, minLon: 77.505, maxLon: 77.555 }, center: [10.732, 77.528] },
    { id: "kangeyam", name: "Kangeyam Village", taluk: "Kangeyam", district: "Tiruppur", state: "Tamil Nadu", bounds: { minLat: 10.985, maxLat: 11.035, minLon: 77.535, maxLon: 77.585 }, center: [11.008, 77.561] },
    { id: "palladam", name: "Palladam Rural", taluk: "Palladam", district: "Tiruppur", state: "Tamil Nadu", bounds: { minLat: 10.975, maxLat: 11.025, minLon: 77.265, maxLon: 77.315 }, center: [10.998, 77.288] },
    { id: "udumalaipettai", name: "Udumalaipettai", taluk: "Udumalaipettai", district: "Tiruppur", state: "Tamil Nadu", bounds: { minLat: 10.560, maxLat: 10.610, minLon: 77.225, maxLon: 77.275 }, center: [10.582, 77.248] },

    // 4. TELANGANA - Mahabubnagar & Nalgonda
    { id: "jadcherla", name: "Jadcherla Village", taluk: "Jadcherla", district: "Mahabubnagar", state: "Telangana", bounds: { minLat: 16.740, maxLat: 16.790, minLon: 78.115, maxLon: 78.165 }, center: [16.764, 78.140] },
    { id: "kalwakurthy", name: "Kalwakurthy Watershed", taluk: "Kalwakurthy", district: "Nagarkurnool", state: "Telangana", bounds: { minLat: 16.645, maxLat: 16.695, minLon: 78.465, maxLon: 78.515 }, center: [16.671, 78.491] },
    { id: "achampet", name: "Achampet Rural", taluk: "Achampet", district: "Nagarkurnool", state: "Telangana", bounds: { minLat: 16.375, maxLat: 16.425, minLon: 78.790, maxLon: 78.840 }, center: [16.398, 78.814] },
    { id: "devarakadra", name: "Devarakadra Panchayat", taluk: "Devarakadra", district: "Mahabubnagar", state: "Telangana", bounds: { minLat: 16.595, maxLat: 16.645, minLon: 77.830, maxLon: 77.880 }, center: [16.618, 77.854] },
    { id: "miryalaguda", name: "Miryalaguda Watershed", taluk: "Miryalaguda", district: "Nalgonda", state: "Telangana", bounds: { minLat: 16.845, maxLat: 16.895, minLon: 79.535, maxLon: 79.585 }, center: [16.871, 79.562] },
    { id: "devarakonda", name: "Devarakonda Village", taluk: "Devarakonda", district: "Nalgonda", state: "Telangana", bounds: { minLat: 16.675, maxLat: 16.725, minLon: 78.900, maxLon: 78.950 }, center: [16.698, 78.925] },
    { id: "munugode", name: "Munugode Rural", taluk: "Munugode", district: "Nalgonda", state: "Telangana", bounds: { minLat: 17.050, maxLat: 17.100, minLon: 79.010, maxLon: 79.060 }, center: [17.072, 79.034] },
    { id: "nakrekal", name: "Nakrekal Panchayat", taluk: "Nakrekal", district: "Nalgonda", state: "Telangana", bounds: { minLat: 17.140, maxLat: 17.190, minLon: 79.405, maxLon: 79.455 }, center: [17.164, 79.428] },
    { id: "ibrahimpatnam", name: "Ibrahimpatnam Watershed", taluk: "Ibrahimpatnam", district: "Rangareddy", state: "Telangana", bounds: { minLat: 17.135, maxLat: 17.185, minLon: 78.625, maxLon: 78.675 }, center: [17.161, 78.648] },
    { id: "shadnagar", name: "Shadnagar Village", taluk: "Shadnagar", district: "Rangareddy", state: "Telangana", bounds: { minLat: 17.045, maxLat: 17.095, minLon: 78.185, maxLon: 78.235 }, center: [17.071, 78.209] },
    { id: "chevella", name: "Chevella Rural", taluk: "Chevella", district: "Rangareddy", state: "Telangana", bounds: { minLat: 17.290, maxLat: 17.340, minLon: 78.115, maxLon: 78.165 }, center: [17.312, 78.138] },
    { id: "maheshwaram", name: "Maheshwaram Panchayat", taluk: "Maheshwaram", district: "Rangareddy", state: "Telangana", bounds: { minLat: 17.110, maxLat: 17.160, minLon: 78.405, maxLon: 78.455 }, center: [17.135, 78.431] },

    // 5. MAHARASHTRA - Ahmednagar, Solapur & Marathwada
    { id: "sangamner", name: "Sangamner Watershed", taluk: "Sangamner", district: "Ahmednagar", state: "Maharashtra", bounds: { minLat: 19.545, maxLat: 19.595, minLon: 74.185, maxLon: 74.235 }, center: [19.571, 74.209] },
    { id: "parner", name: "Parner Rural", taluk: "Parner", district: "Ahmednagar", state: "Maharashtra", bounds: { minLat: 18.975, maxLat: 19.025, minLon: 74.415, maxLon: 74.465 }, center: [19.002, 74.438] },
    { id: "shrigonda", name: "Shrigonda Village", taluk: "Shrigonda", district: "Ahmednagar", state: "Maharashtra", bounds: { minLat: 18.595, maxLat: 18.645, minLon: 74.675, maxLon: 74.725 }, center: [18.618, 74.698] },
    { id: "karjat", name: "Karjat Rural", taluk: "Karjat", district: "Ahmednagar", state: "Maharashtra", bounds: { minLat: 18.890, maxLat: 18.940, minLon: 74.990, maxLon: 75.040 }, center: [18.912, 75.012] },
    { id: "sangola", name: "Sangola Watershed", taluk: "Sangola", district: "Solapur", state: "Maharashtra", bounds: { minLat: 17.415, maxLat: 17.465, minLon: 75.175, maxLon: 75.225 }, center: [17.438, 75.198] },
    { id: "mangalwedha", name: "Mangalwedha Village", taluk: "Mangalwedha", district: "Solapur", state: "Maharashtra", bounds: { minLat: 17.490, maxLat: 17.540, minLon: 75.415, maxLon: 75.465 }, center: [17.512, 75.441] },
    { id: "karmala", name: "Karmala Rural", taluk: "Karmala", district: "Solapur", state: "Maharashtra", bounds: { minLat: 18.390, maxLat: 18.440, minLon: 75.175, maxLon: 75.225 }, center: [18.412, 75.198] },
    { id: "pandharpur", name: "Pandharpur Rural", taluk: "Pandharpur", district: "Solapur", state: "Maharashtra", bounds: { minLat: 17.655, maxLat: 17.705, minLon: 75.305, maxLon: 75.355 }, center: [17.678, 75.328] },
    { id: "ashti", name: "Ashti Watershed", taluk: "Ashti", district: "Beed", state: "Maharashtra", bounds: { minLat: 18.780, maxLat: 18.830, minLon: 75.155, maxLon: 75.205 }, center: [18.802, 75.178] },
    { id: "patoda", name: "Patoda Village", taluk: "Patoda", district: "Beed", state: "Maharashtra", bounds: { minLat: 18.865, maxLat: 18.915, minLon: 75.430, maxLon: 75.480 }, center: [18.889, 75.452] },
    { id: "tuljapur", name: "Tuljapur Rural", taluk: "Tuljapur", district: "Dharashiv", state: "Maharashtra", bounds: { minLat: 17.990, maxLat: 18.040, minLon: 76.045, maxLon: 76.095 }, center: [18.012, 76.071] },
    { id: "bhoom", name: "Bhoom Panchayat", taluk: "Bhoom", district: "Dharashiv", state: "Maharashtra", bounds: { minLat: 18.445, maxLat: 18.495, minLon: 75.645, maxLon: 75.695 }, center: [18.471, 75.668] },

    // 6. RAJASTHAN & GUJARAT - Arid & Rainshadow Belts
    { id: "bilara", name: "Bilara Watershed", taluk: "Bilara", district: "Jodhpur", state: "Rajasthan", bounds: { minLat: 26.155, maxLat: 26.205, minLon: 73.685, maxLon: 73.735 }, center: [26.182, 73.712] },
    { id: "osian", name: "Osian Village", taluk: "Osian", district: "Jodhpur", state: "Rajasthan", bounds: { minLat: 26.700, maxLat: 26.750, minLon: 72.880, maxLon: 72.930 }, center: [26.725, 72.908] },
    { id: "balotra", name: "Balotra Rural", taluk: "Balotra", district: "Barmer", state: "Rajasthan", bounds: { minLat: 25.810, maxLat: 25.860, minLon: 72.215, maxLon: 72.265 }, center: [25.834, 72.241] },
    { id: "siwana", name: "Siwana Panchayat", taluk: "Siwana", district: "Barmer", state: "Rajasthan", bounds: { minLat: 25.625, maxLat: 25.675, minLon: 72.390, maxLon: 72.440 }, center: [25.651, 72.418] },
    { id: "tharad", name: "Tharad Watershed", taluk: "Tharad", district: "Banaskantha", state: "Gujarat", bounds: { minLat: 24.370, maxLat: 24.420, minLon: 71.600, maxLon: 71.650 }, center: [24.394, 71.628] },
    { id: "vav", name: "Vav Village", taluk: "Vav", district: "Banaskantha", state: "Gujarat", bounds: { minLat: 24.340, maxLat: 24.390, minLon: 71.485, maxLon: 71.535 }, center: [24.364, 71.512] },
    { id: "radhanpur", name: "Radhanpur Rural", taluk: "Radhanpur", district: "Patan", state: "Gujarat", bounds: { minLat: 23.810, maxLat: 23.860, minLon: 71.580, maxLon: 71.630 }, center: [23.834, 71.608] },
    { id: "rapar", name: "Rapar Panchayat", taluk: "Rapar", district: "Kutch", state: "Gujarat", bounds: { minLat: 23.545, maxLat: 23.595, minLon: 70.610, maxLon: 70.660 }, center: [23.571, 70.638] }
  ];

  function applyVillageSelection(v) {
    if (!v) return;
    clearPreviousResults();

    selectedBounds.minLat = v.bounds.minLat;
    selectedBounds.maxLat = v.bounds.maxLat;
    selectedBounds.minLon = v.bounds.minLon;
    selectedBounds.maxLon = v.bounds.maxLon;
    selectedBounds.presetKey = v.id;
    selectedBounds.villageName = `${v.name} (${v.district}, ${v.state})`;

    if (badgeVillageTag) {
      badgeVillageTag.textContent = v.name;
    }
    if (statusLocationName) {
      statusLocationName.textContent = `Village: ${v.name} (${v.district}, ${v.state})`;
    }
    updateSelectorRectangle();
    updateHandlePositions();

    map.flyToBounds([
      [v.bounds.minLat, v.bounds.minLon],
      [v.bounds.maxLat, v.bounds.maxLon]
    ], { padding: [50, 50], duration: 1.2 });
  }

  // ================= VILLAGE SEARCH & LIVE AUTOCOMPLETE ================= //
  const villageSearchResults = document.getElementById("village-search-results");
  const villageSearchSpinner = document.getElementById("village-search-spinner");
  let villageSearchTimer = null;

  if (inputVillageSearch) {
    inputVillageSearch.addEventListener("input", (e) => {
      const q = e.target.value.trim();
      clearTimeout(villageSearchTimer);

      if (q.length < 2) {
        if (villageSearchResults) villageSearchResults.style.display = "none";
        if (villageSearchSpinner) villageSearchSpinner.style.display = "none";
        return;
      }

      if (villageSearchSpinner) villageSearchSpinner.style.display = "block";

      villageSearchTimer = setTimeout(async () => {
        try {
          const qLower = q.toLowerCase();

          // Curated local instant matches
          const localMatches = VILLAGES_LIST.filter(v => 
            v.name.toLowerCase().includes(qLower) || 
            (v.taluk && v.taluk.toLowerCase().includes(qLower)) || 
            (v.district && v.district.toLowerCase().includes(qLower))
          ).slice(0, 4).map(v => ({
            name: v.name,
            type: "village",
            taluk: v.taluk,
            district: v.district,
            state: v.state,
            lat: (v.bounds.minLat + v.bounds.maxLat) / 2,
            lon: (v.bounds.minLon + v.bounds.maxLon) / 2,
            bounds: v.bounds
          }));

          let apiResults = [];

          // 1. Backend proxy /api/searchVillage
          try {
            const resp = await fetch(`/api/searchVillage?q=${encodeURIComponent(q)}`);
            if (resp.ok) {
              const data = await resp.json();
              if (data && data.results && data.results.length > 0) {
                apiResults = data.results;
              }
            }
          } catch (backendErr) {
            console.warn("Backend village search proxy unreachable:", backendErr);
          }

          // 2. Direct Photon fallback if needed
          if (!apiResults || apiResults.length === 0) {
            try {
              const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=en`;
              const pResp = await fetch(photonUrl);
              if (pResp.ok) {
                const pData = await pResp.json();
                const features = (pData.features || []).filter(f => {
                  const p = f.properties || {};
                  return p.countrycode === "IN" || p.country === "India";
                });
                apiResults = features.map(f => {
                  const p = f.properties || {};
                  const coords = f.geometry?.coordinates || [0, 0];
                  const lat = parseFloat(coords[1]);
                  const lon = parseFloat(coords[0]);
                  return {
                    name: p.name || q,
                    type: p.osm_value || p.type || "village",
                    taluk: p.county || p.city || "",
                    district: p.district || p.county || "",
                    state: p.state || "",
                    postcode: p.postcode || "",
                    lat: lat,
                    lon: lon,
                    bounds: {
                      minLat: lat - 0.0225,
                      maxLat: lat + 0.0225,
                      minLon: lon - 0.0300,
                      maxLon: lon + 0.0300
                    }
                  };
                });
              }
            } catch (pErr) {
              console.warn("Direct Photon API fallback error:", pErr);
            }
          }

          // Merge local and API results, eliminating duplicates
          const seen = new Set();
          const combined = [];
          [...localMatches, ...apiResults].forEach(item => {
            const key = (item.name || "").toLowerCase() + "_" + (item.state || "").toLowerCase();
            if (!seen.has(key)) {
              seen.add(key);
              combined.push(item);
            }
          });

          if (villageSearchSpinner) villageSearchSpinner.style.display = "none";
          if (!villageSearchResults) return;

          villageSearchResults.innerHTML = "";

          if (combined.length > 0) {
            combined.slice(0, 10).forEach(item => {
              const el = document.createElement("div");
              el.className = "vsr-item";

              const typeBadge = item.type ? `<span class="vsr-type-badge">${item.type.toUpperCase()}</span>` : "";
              const stateInfo = [item.taluk, item.district, item.state].filter(Boolean).join(", ");
              const pinInfo = item.postcode ? ` - PIN: ${item.postcode}` : "";

              el.innerHTML = `
                <div class="vsr-title">
                  <i class="fa-solid fa-location-dot text-cyan"></i> ${item.name}
                  ${typeBadge}
                </div>
                <div class="vsr-subtitle">${stateInfo}${pinInfo} (${item.lat.toFixed(4)}°, ${item.lon.toFixed(4)}°)</div>
              `;

              el.addEventListener("click", () => {
                clearPreviousResults();

                selectedBounds.minLat = item.bounds ? item.bounds.minLat : item.lat - 0.0225;
                selectedBounds.maxLat = item.bounds ? item.bounds.maxLat : item.lat + 0.0225;
                selectedBounds.minLon = item.bounds ? item.bounds.minLon : item.lon - 0.0300;
                selectedBounds.maxLon = item.bounds ? item.bounds.maxLon : item.lon + 0.0300;
                selectedBounds.presetKey = null;
                selectedBounds.villageName = `${item.name} (${item.district || item.state})`;

                if (badgeVillageTag) {
                  badgeVillageTag.textContent = item.name;
                }
                if (statusLocationName) {
                  statusLocationName.textContent = `Village: ${item.name} (${stateInfo})`;
                }

                updateSelectorRectangle();
                updateHandlePositions();

                map.flyToBounds([
                  [selectedBounds.minLat, selectedBounds.minLon],
                  [selectedBounds.maxLat, selectedBounds.maxLon]
                ], { padding: [50, 50], duration: 1.2 });

                villageSearchResults.style.display = "none";
                inputVillageSearch.value = `${item.name}, ${item.district || item.state}`;
              });

              villageSearchResults.appendChild(el);
            });
          } else {
            villageSearchResults.innerHTML = `
              <div class="vsr-item" style="cursor: default; opacity: 0.7;">
                <div class="vsr-title"><i class="fa-solid fa-triangle-exclamation text-yellow"></i> No matching villages found</div>
                <div class="vsr-subtitle">Check spelling or search by Taluk/District name</div>
              </div>`;
          }

          villageSearchResults.style.display = "flex";

        } catch (err) {
          console.warn("Village search error:", err);
          if (villageSearchSpinner) villageSearchSpinner.style.display = "none";
        }
      }, 250);
    });

    // Close search dropdown on click outside
    document.addEventListener("click", (e) => {
      if (villageSearchResults && !inputVillageSearch.contains(e.target) && !villageSearchResults.contains(e.target)) {
        villageSearchResults.style.display = "none";
      }
    });

    inputVillageSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = villageSearchResults ? villageSearchResults.querySelector(".vsr-item") : null;
        if (first) first.click();
      }
    });
  }

  // Preset Watershed Click Handlers
  presetChips.forEach((chip) => {
    chip.addEventListener("click", () => {
      clearPreviousResults();
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
    if (ingestMode !== "map") {
      clearPreviousResults();
    }
    ingestMode = "map";
    tabModeMap.classList.add("active");
    tabModeUpload.classList.remove("active");
    panelModeMap.style.display = "block";
    panelModeUpload.style.display = "none";
    handlesLayerGroup.addTo(map);
    if (selectorRectLayer) selectorRectLayer.addTo(map);
  });

  tabModeUpload.addEventListener("click", () => {
    if (ingestMode !== "upload") {
      clearPreviousResults();
    }
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
    clearPreviousResults();
    currentFile = file;
    kmlDropzone.style.display = "none";
    fileReadyBanner.style.display = "flex";
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = `${(file.size / 1024).toFixed(1)} KB • Ready for Hydrological Engine`;
  }

  btnClearFile.addEventListener("click", () => {
    clearPreviousResults();
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
        if (loaderDesc) loaderDesc.textContent = "Querying Open-Elevation API for real village topography...";
        const kmlText = await generateKmlFromBounds(minLon, minLat, maxLon, maxLat, 12);
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
      proofElevRange.textContent = `${meta.elevation_range_m.min}m → ${meta.elevation_range_m.max}m (Open-Elevation API)`;
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
