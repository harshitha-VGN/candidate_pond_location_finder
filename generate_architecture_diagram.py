import matplotlib.pyplot as plt
import matplotlib.patches as patches

def draw_architecture():
    fig, ax = plt.subplots(figsize=(11.5, 7.8), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')

    # Styling colors
    c_l1_bg = "#F0F7FF"
    c_l1_border = "#1E40AF"
    c_l2_bg = "#F0FDF4"
    c_l2_border = "#15803D"
    c_l3_bg = "#FFFBEB"
    c_l3_border = "#B45309"
    c_mod_bg = "#FFFFFF"
    c_mod_border = "#94A3B8"
    c_arrow = "#1E293B"

    # Font sizes
    fs_title = 11.5
    fs_box = 8.2
    fs_flow = 7.2
    fs_sub = 7.0

    # ================= LAYER 1: CLIENT =================
    rect_l1 = patches.FancyBboxPatch((4, 73.5), 92, 23.5, boxstyle="round,pad=0.6,rounding_size=1.5",
                                     edgecolor=c_l1_border, facecolor=c_l1_bg, linewidth=1.5)
    ax.add_patch(rect_l1)
    ax.text(6, 93.5, "Layer 1: Web-GIS Client (Browser Frontend)", fontsize=fs_title, fontweight='bold', color=c_l1_border)

    # Sub-modules inside Layer 1
    l1_items = [
        ("Leaflet.js Map Canvas\n• Esri Satellite Tiles\n• Topo Contours Layer\n• Real-Time Bounding Box", 6, 75.5, 21, 15),
        ("Village & Area Selection\n• Minimal Search Bar\n• Auto-Complete & Centering\n• KML/KMZ File Upload", 28.5, 75.5, 21.5, 15),
        ("Dynamic Overlays\n• D8 Catchment Polygons\n• Ranked Site Markers\n• Storage Badges", 51.5, 75.5, 21, 15),
        ("Results & Export Panel\n• Optimal Site Metrics\n• Runoff & Capacity Charts\n• GeoJSON / CSV Export", 74, 75.5, 20.5, 15)
    ]
    for title, x, y, w, h in l1_items:
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1",
                                   edgecolor=c_mod_border, facecolor=c_mod_bg, linewidth=1)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=fs_box, ha='center', va='center', color="#0F172A")

    # ================= ARROWS: LAYER 1 <-> LAYER 2 =================
    # Village Search Request/Response (left arrow pair)
    ax.annotate('', xy=(22, 53.5), xytext=(22, 73.5),
                arrowprops=dict(facecolor="#2563EB", edgecolor="#2563EB", width=1.2, headwidth=5, shrink=0.02))
    ax.annotate('', xy=(27, 73.5), xytext=(27, 53.5),
                arrowprops=dict(facecolor="#2563EB", edgecolor="#2563EB", width=1.2, headwidth=5, shrink=0.02))
    ax.text(24.5, 63.5, "GET /api/searchVillage?q=...\n[Live Autocomplete & Bounds]",
            fontsize=6.8, ha='center', va='center', fontweight='bold', color="#1E40AF",
            bbox=dict(boxstyle="round,pad=0.25", facecolor="#EFF6FF", edgecolor="#93C5FD", linewidth=0.8))

    # Hydrological Analysis Request (center arrow down)
    ax.annotate('', xy=(46, 53.5), xytext=(46, 73.5),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.02))
    ax.text(44.5, 63.5, "POST /analyzeContour\n[multipart: KML, top_n, grid_res]",
            fontsize=fs_flow, ha='right', va='center', fontweight='bold', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.8))

    # Response arrow (right arrow up)
    ax.annotate('', xy=(72, 73.5), xytext=(72, 53.5),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.02))
    ax.text(73.5, 63.5, "HTTP 200: GeoJSON FeatureCollection\n[Catchment Basins, Sites, Storage & Runoff]",
            fontsize=fs_flow, ha='left', va='center', fontweight='bold', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.8))

    # ================= LAYER 2: BACKEND =================
    rect_l2 = patches.FancyBboxPatch((4, 23.5), 92, 30, boxstyle="round,pad=0.6,rounding_size=1.5",
                                     edgecolor=c_l2_border, facecolor=c_l2_bg, linewidth=1.5)
    ax.add_patch(rect_l2)
    ax.text(6, 50.5, "Layer 2: Python Flask REST API Backend (Port 5000 / 5245)", fontsize=fs_title, fontweight='bold', color=c_l2_border)
    ax.text(62, 50.5, "Stateless In-Memory Modular Monolith", fontsize=8.8, fontstyle='italic', color="#374151")

    # Pipeline stages
    pipeline = [
        ("kml_parser.py\nExtract contour\ncoords & elev", 6, 32.5, 13.5, 14),
        ("dem_builder.py\nBicubic interp.\n& micro-perturb.", 21.5, 32.5, 13.5, 14),
        ("terrain_analysis.py\nD8 flow routing,\naccum. & river buf", 37, 32.5, 14, 14),
        ("catchment.py\nReverse-BFS\nupstream basin", 53, 32.5, 13.5, 14),
        ("pond_selector.py\nMulti-criteria score\n& runoff sizing", 68.5, 32.5, 13.5, 14),
        ("geojson_builder.py\nAssemble GeoJSON\nFeatureCollection", 83.5, 32.5, 11, 14)
    ]

    for i, (title, x, y, w, h) in enumerate(pipeline):
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1",
                                   edgecolor=c_l2_border, facecolor=c_mod_bg, linewidth=1.2)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=7.2, ha='center', va='center', color="#0F172A")

        # Arrow to next pipeline module
        if i < len(pipeline) - 1:
            ax.annotate('', xy=(pipeline[i+1][1]-0.2, y + h/2), xytext=(x + w + 0.2, y + h/2),
                        arrowprops=dict(arrowstyle="->", color="#15803D", lw=1.5))

    # Caching Component inside Layer 2
    r_cache = patches.FancyBboxPatch((6, 25), 88.5, 5.8, boxstyle="round,pad=0.3,rounding_size=0.8",
                                     edgecolor="#64748B", facecolor="#F8FAFC", linewidth=1, linestyle="--")
    ax.add_patch(r_cache)
    ax.text(50, 27.9, "In-Memory Rainfall Cache: _rain_cache dict keyed by round(lat, 2), round(lon, 2) [Sub-millisecond access & HTTP 429 fallback]",
            fontsize=7.8, ha='center', va='center', fontweight='bold', color="#334155")

    # ================= ARROWS: LAYER 2 <-> LAYER 3 =================
    # Left arrow: Village search proxy to Photon
    ax.annotate('', xy=(20, 13.5), xytext=(20, 23.5),
                arrowprops=dict(facecolor="#B45309", edgecolor="#B45309", width=1.2, headwidth=5, shrink=0.02))
    ax.annotate('', xy=(24, 23.5), xytext=(24, 13.5),
                arrowprops=dict(facecolor="#B45309", edgecolor="#B45309", width=1.2, headwidth=5, shrink=0.02))
    ax.text(22, 18.5, "Photon OSM Query\n(Academic headers)", fontsize=6.5, ha='center', va='center', color="#78350F",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFBEB", edgecolor="#FCD34D", linewidth=0.6))

    # Center arrow: Open-Meteo Rainfall query
    ax.annotate('', xy=(50, 13.5), xytext=(50, 23.5),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.3, headwidth=5, shrink=0.02))
    ax.annotate('', xy=(56, 23.5), xytext=(56, 13.5),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.3, headwidth=5, shrink=0.02))
    ax.text(53, 18.5, "Open-Meteo REST API\n(Daily Precipitation 2018–2025)", fontsize=6.8, ha='center', va='center', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.6))

    # Right arrow: Open-Elevation API & Tiles
    ax.annotate('', xy=(80, 13.5), xytext=(80, 23.5),
                arrowprops=dict(facecolor="#B45309", edgecolor="#B45309", width=1.2, headwidth=5, shrink=0.02))
    ax.annotate('', xy=(84, 23.5), xytext=(84, 13.5),
                arrowprops=dict(facecolor="#B45309", edgecolor="#B45309", width=1.2, headwidth=5, shrink=0.02))
    ax.text(82, 18.5, "Open-Elevation &\nMap Tile Lookups", fontsize=6.5, ha='center', va='center', color="#78350F",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFBEB", edgecolor="#FCD34D", linewidth=0.6))

    # ================= LAYER 3: EXTERNAL SERVICES =================
    rect_l3 = patches.FancyBboxPatch((4, 2), 92, 11.5, boxstyle="round,pad=0.5,rounding_size=1.2",
                                     edgecolor=c_l3_border, facecolor=c_l3_bg, linewidth=1.5)
    ax.add_patch(rect_l3)
    ax.text(6, 7.8, "Layer 3: External Data\n& Cloud Services", fontsize=fs_title, fontweight='bold', color=c_l3_border, va='center')

    ext_items = [
        ("Photon / OSM GeoEngine API\n(650,000+ Indian Villages Geocoding)", 25, 3.5, 23, 8.2),
        ("Open-Meteo Historical Archive API\n(Precipitation Time-Series 2018–2025)", 49.5, 3.5, 23, 8.2),
        ("Open-Elevation & Esri / OSM Servers\n(Real Elevation & Satellite Map Tiles)", 74, 3.5, 20.5, 8.2)
    ]
    for title, x, y, w, h in ext_items:
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.3,rounding_size=0.8",
                                   edgecolor=c_l3_border, facecolor=c_mod_bg, linewidth=1)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=7.2, ha='center', va='center', color="#0F172A")

    plt.tight_layout()
    plt.savefig("/Users/harshita/Desktop/venv/csd_pond/fig_architecture.png", dpi=300, bbox_inches='tight')
    print("Enhanced architecture diagram saved successfully!")

if __name__ == "__main__":
    draw_architecture()

