import matplotlib.pyplot as plt
import matplotlib.patches as patches

def draw_architecture():
    fig, ax = plt.subplots(figsize=(11, 7.2), dpi=300)
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
    fs_box = 8.5
    fs_flow = 7.5
    fs_sub = 7.5

    # ================= LAYER 1: CLIENT =================
    rect_l1 = patches.FancyBboxPatch((4, 73), 92, 23.5, boxstyle="round,pad=0.6,rounding_size=1.5",
                                     edgecolor=c_l1_border, facecolor=c_l1_bg, linewidth=1.5)
    ax.add_patch(rect_l1)
    ax.text(6, 93, "Layer 1: Web-GIS Client (Browser Frontend)", fontsize=fs_title, fontweight='bold', color=c_l1_border)

    # Sub-modules inside Layer 1
    l1_items = [
        ("Leaflet.js Map Canvas\n• Esri Satellite Tiles\n• OpenTopoMap Contours", 6, 75.5, 20.5, 14.5),
        ("User Spatial Input\n• Interactive Bounding Box\n• KML/KMZ File Upload", 28.5, 75.5, 20.5, 14.5),
        ("Dynamic Overlays\n• D8 Catchment Polygons\n• Ranked Site Markers", 51, 75.5, 20.5, 14.5),
        ("Results & Export Panel\n• Optimal Site Metrics\n• GeoJSON / CSV Export", 73.5, 75.5, 20.5, 14.5)
    ]
    for title, x, y, w, h in l1_items:
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1",
                                   edgecolor=c_mod_border, facecolor=c_mod_bg, linewidth=1)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=fs_box, ha='center', va='center', color="#0F172A")

    # ================= ARROWS: LAYER 1 <-> LAYER 2 =================
    # Request arrow (down)
    ax.annotate('', xy=(37, 53.5), xytext=(37, 73),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.02))
    ax.text(35.5, 63.2, "HTTP POST /analyzeContour\n[multipart/form-data: KML/KMZ file, top_n, grid_res]",
            fontsize=fs_flow, ha='right', va='center', fontweight='bold', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.8))

    # Response arrow (up)
    ax.annotate('', xy=(63, 73), xytext=(63, 53.5),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.02))
    ax.text(64.5, 63.2, "HTTP 200 OK: GeoJSON FeatureCollection\n[Polygons, Ranked Pond Sites, Runoff, Sizing]",
            fontsize=fs_flow, ha='left', va='center', fontweight='bold', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.3", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.8))

    # ================= LAYER 2: BACKEND =================
    rect_l2 = patches.FancyBboxPatch((4, 23), 92, 30.5, boxstyle="round,pad=0.6,rounding_size=1.5",
                                     edgecolor=c_l2_border, facecolor=c_l2_bg, linewidth=1.5)
    ax.add_patch(rect_l2)
    ax.text(6, 50, "Layer 2: Python Flask REST API Backend (Port 5000 / 5245)", fontsize=fs_title, fontweight='bold', color=c_l2_border)
    ax.text(63, 50, "Stateless In-Memory Modular Monolith", fontsize=9, fontstyle='italic', color="#374151")

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
    r_cache = patches.FancyBboxPatch((6, 25), 88.5, 5.5, boxstyle="round,pad=0.3,rounding_size=0.8",
                                     edgecolor="#64748B", facecolor="#F8FAFC", linewidth=1, linestyle="--")
    ax.add_patch(r_cache)
    ax.text(50, 27.7, "In-Memory Rainfall Cache: _rain_cache dict keyed by round(lat, 2), round(lon, 2) [Sub-millisecond repeat access]",
            fontsize=8, ha='center', va='center', fontweight='bold', color="#334155")

    # ================= ARROWS: LAYER 2 <-> LAYER 3 =================
    ax.annotate('', xy=(42, 13), xytext=(42, 23),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.02))
    ax.text(40.5, 18, "HTTP GET /v1/archive (lat, lon, 2018-2025)", fontsize=fs_sub, ha='right', va='center', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.6))

    ax.annotate('', xy=(58, 23), xytext=(58, 13),
                arrowprops=dict(facecolor=c_arrow, edgecolor=c_arrow, width=1.5, headwidth=6, shrink=0.02))
    ax.text(59.5, 18, "JSON daily precipitation series", fontsize=fs_sub, ha='left', va='center', color="#1E293B",
            bbox=dict(boxstyle="round,pad=0.2", facecolor="#FFFFFF", edgecolor="#CBD5E1", linewidth=0.6))

    # ================= LAYER 3: EXTERNAL SERVICES =================
    rect_l3 = patches.FancyBboxPatch((4, 2), 92, 11, boxstyle="round,pad=0.5,rounding_size=1.2",
                                     edgecolor=c_l3_border, facecolor=c_l3_bg, linewidth=1.5)
    ax.add_patch(rect_l3)
    ax.text(6, 7.5, "Layer 3: External Data\n& Cloud Services", fontsize=fs_title, fontweight='bold', color=c_l3_border, va='center')

    ext_items = [
        ("Open-Meteo Historical Archive REST API\n(Daily Precipitation Records 2018–2025)", 31, 3.5, 31, 7.8),
        ("Esri & OpenTopoMap Tile Servers\n(Satellite Imagery & Contour Base Layers)", 64, 3.5, 30.5, 7.8)
    ]
    for title, x, y, w, h in ext_items:
        r = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.3,rounding_size=0.8",
                                   edgecolor=c_l3_border, facecolor=c_mod_bg, linewidth=1)
        ax.add_patch(r)
        ax.text(x + w/2, y + h/2, title, fontsize=7.6, ha='center', va='center', color="#0F172A")

    plt.tight_layout()
    plt.savefig("/Users/harshita/Desktop/venv/csd_pond/fig_architecture.png", dpi=300, bbox_inches='tight')
    print("Clean architecture diagram saved!")

if __name__ == "__main__":
    draw_architecture()
