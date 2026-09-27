import matplotlib.pyplot as plt
import matplotlib.patches as patches

def draw_architecture():
    fig, ax = plt.subplots(figsize=(11.5, 8.2), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')

    # Theme colors
    c_l1_bg = "#F0F7FF"
    c_l1_border = "#1E40AF"
    c_l2_bg = "#F0FDF4"
    c_l2_border = "#15803D"
    c_l3_bg = "#FFFBEB"
    c_l3_border = "#B45309"
    c_mod_bg = "#FFFFFF"
    c_mod_border = "#94A3B8"
    c_arrow = "#1E293B"

    # ================= LAYER 1: CLIENT =================
    rect_l1 = patches.FancyBboxPatch((4, 75.5), 92, 22.5, boxstyle="round,pad=0.6,rounding_size=1.5",
                                     edgecolor=c_l1_border, facecolor=c_l1_bg, linewidth=1.5)
    ax.add_patch(rect_l1)
    ax.text(6, 95.2, "Layer 1: Web-GIS Client (Browser Frontend)", fontsize=11, fontweight='bold', color=c_l1_border)

    l1_items = [
        ("Leaflet.js Map Canvas\n• Esri Satellite Tiles\n• Topo Contours Layer\n• Dynamic Bounding Box", 6, 77.5, 21, 15),
        ("Village & Area Selection\n• Minimal Search Bar\n• Auto-Complete & Centering\n• KML/KMZ File Upload", 28.5, 77.5, 21.5, 15),
        ("Dynamic Overlays\n• D8 Catchment Polygons\n• Ranked Site Markers\n• Storage Capacity Badges", 51.5, 77.5, 21, 15),
        ("Results & Export Panel\n• Optimal Site Metrics\n• Runoff & Capacity Charts\n• GeoJSON / CSV Export", 74, 77.5, 20.5, 15)
    ]
    for title, x, y, w, h in l1_items:
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1",
                                   edgecolor=c_mod_border, facecolor=c_mod_bg, linewidth=1)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=8, ha='center', va='center', color="#0F172A")

    # ================= REST API GATEWAY (CLEAN CONNECTOR BETWEEN L1 & L2) =================
    rect_api = patches.FancyBboxPatch((6, 61), 88, 9.5, boxstyle="round,pad=0.5,rounding_size=1.2",
                                      edgecolor="#0284C7", facecolor="#F0F9FF", linewidth=1.4)
    ax.add_patch(rect_api)
    ax.text(8, 67.8, "REST API Endpoints & Request Routing (HTTP / JSON)", fontsize=9.2, fontweight='bold', color="#0369A1")

    # Clean endpoint cards
    api_items = [
        ("POST /analyzeContour", "Upload contour KML/KMZ or bounds \u2192 returns GeoJSON ranked sites & catchments", 8, 62.2, 53, 4.6),
        ("GET /api/searchVillage", "q={query} \u2192 village lat/lon & bounds", 62.5, 62.2, 30, 4.6)
    ]
    for ep, desc, x, y, w, h in api_items:
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.3,rounding_size=0.8",
                                   edgecolor="#BAE6FD", facecolor="#FFFFFF", linewidth=1)
        ax.add_patch(r)
        ax.text(x + 1.5, y + h/2, ep, fontsize=8, fontweight='bold', color="#0F172A", va='center')
        ax.text(x + w - 1.5, y + h/2, desc, fontsize=7.2, color="#475569", va='center', ha='right')

    # Two clear, uncluttered vertical arrows between Layer 1 and API Gateway
    ax.annotate('', xy=(34, 70.5), xytext=(34, 75.5),
                arrowprops=dict(facecolor="#2563EB", edgecolor="#2563EB", width=1.5, headwidth=5.5, shrink=0.05))
    ax.text(32.5, 73, "HTTP Requests (Uploads & Queries)", fontsize=7.2, ha='right', va='center', color="#1E40AF", fontweight='bold')

    ax.annotate('', xy=(66, 75.5), xytext=(66, 70.5),
                arrowprops=dict(facecolor="#16A34A", edgecolor="#16A34A", width=1.5, headwidth=5.5, shrink=0.05))
    ax.text(67.5, 73, "HTTP 200 Responses (GeoJSON & Bounds)", fontsize=7.2, ha='left', va='center', color="#15803D", fontweight='bold')

    # Single clean dispatch arrow from API Gateway into Layer 2 Pipeline
    ax.annotate('', xy=(50, 52), xytext=(50, 61),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.05))
    ax.text(50, 56.5, "In-Memory Internal Dispatch to Hydrological Pipeline", fontsize=7.2, ha='center', va='center',
            color="#1E293B", fontweight='bold', bbox=dict(boxstyle="round,pad=0.25", facecolor="#FFFFFF", edgecolor="#CBD5E1", lw=0.7))

    # ================= LAYER 2: BACKEND =================
    rect_l2 = patches.FancyBboxPatch((4, 21), 92, 31, boxstyle="round,pad=0.6,rounding_size=1.5",
                                     edgecolor=c_l2_border, facecolor=c_l2_bg, linewidth=1.5)
    ax.add_patch(rect_l2)
    ax.text(6, 49, "Layer 2: Python Flask REST API Backend (Port 5000 / 5245)", fontsize=11, fontweight='bold', color=c_l2_border)
    ax.text(62, 49, "Stateless In-Memory Modular Monolith", fontsize=8.8, fontstyle='italic', color="#374151")

    pipeline = [
        ("kml_parser.py\nExtract contour\ncoords & elev", 6, 31, 13.5, 14),
        ("dem_builder.py\nBicubic interp.\n& micro-perturb.", 21.5, 31, 13.5, 14),
        ("terrain_analysis.py\nD8 flow routing,\naccum. & river buf", 37, 31, 14, 14),
        ("catchment.py\nReverse-BFS\nupstream basin", 53, 31, 13.5, 14),
        ("pond_selector.py\nMulti-criteria score\n& runoff sizing", 68.5, 31, 13.5, 14),
        ("geojson_builder.py\nAssemble GeoJSON\nFeatureCollection", 83.5, 31, 11, 14)
    ]

    for i, (title, x, y, w, h) in enumerate(pipeline):
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1",
                                   edgecolor=c_l2_border, facecolor=c_mod_bg, linewidth=1.2)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=7.2, ha='center', va='center', color="#0F172A")
        if i < len(pipeline) - 1:
            ax.annotate('', xy=(pipeline[i+1][1]-0.2, y + h/2), xytext=(x + w + 0.2, y + h/2),
                        arrowprops=dict(arrowstyle="->", color="#15803D", lw=1.5))

    # Caching Component inside Layer 2
    r_cache = patches.FancyBboxPatch((6, 23.5), 88.5, 5.5, boxstyle="round,pad=0.3,rounding_size=0.8",
                                     edgecolor="#64748B", facecolor="#F8FAFC", linewidth=1, linestyle="--")
    ax.add_patch(r_cache)
    ax.text(50, 26.2, "In-Memory Rainfall Cache: _rain_cache dict keyed by round(lat, 2), round(lon, 2) [Sub-millisecond access & HTTP 429 fallback]",
            fontsize=7.8, ha='center', va='center', fontweight='bold', color="#334155")

    # ================= ARROWS: LAYER 2 <-> LAYER 3 =================
    ax.annotate('', xy=(22, 13.5), xytext=(22, 21),
                arrowprops=dict(arrowstyle="<->", color="#B45309", lw=1.5))
    ax.text(22, 17.2, "Photon OSM Queries", fontsize=6.8, ha='center', va='center', color="#78350F",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFBEB", edgecolor="#FCD34D", linewidth=0.6))

    ax.annotate('', xy=(53, 13.5), xytext=(53, 21),
                arrowprops=dict(arrowstyle="<->", color=c_arrow, lw=1.5))
    ax.text(53, 17.2, "Open-Meteo Rainfall API", fontsize=6.8, ha='center', va='center', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.6))

    ax.annotate('', xy=(82, 13.5), xytext=(82, 21),
                arrowprops=dict(arrowstyle="<->", color="#B45309", lw=1.5))
    ax.text(82, 17.2, "Open-Elevation & Tile Servers", fontsize=6.8, ha='center', va='center', color="#78350F",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFBEB", edgecolor="#FCD34D", linewidth=0.6))

    # ================= LAYER 3: EXTERNAL SERVICES =================
    rect_l3 = patches.FancyBboxPatch((4, 2), 92, 11.5, boxstyle="round,pad=0.5,rounding_size=1.2",
                                     edgecolor=c_l3_border, facecolor=c_l3_bg, linewidth=1.5)
    ax.add_patch(rect_l3)
    ax.text(6, 7.8, "Layer 3: External Data\n& Cloud Services", fontsize=11, fontweight='bold', color=c_l3_border, va='center')

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
    print("Clean architecture diagram generated and saved!")

if __name__ == "__main__":
    draw_architecture()
