import matplotlib.pyplot as plt
import matplotlib.patches as patches

def draw_algorithm_pipeline():
    fig, ax = plt.subplots(figsize=(12, 7.5), dpi=300)
    ax.set_xlim(0, 100)
    ax.set_ylim(0, 100)
    ax.axis('off')

    # Color Palette
    c_bg = "#F8FAFC"
    c_title = "#0F172A"
    c_box_bg = "#FFFFFF"
    c_arrow = "#2563EB"

    # Step card configurations: (Number, Title, Subtitle, Formula/Logic, EdgeColor, HeaderColor)
    steps = [
        (
            "STEP 1",
            "Bicubic DEM & Micro-Perturbation",
            "kml_parser.py  →  dem_builder.py",
            "• Ingests 3D contour vertices from KML/KMZ\n• Bicubic interpolation onto 120x120 elevation grid\n• Gaussian filter (σ=0.8) removes digitizing noise\n• 1mm micro-perturbation resolves flat plateaus:\n   z_pert(r,c) = z(r,c) + ε,  ε ~ U(-0.001, +0.001)",
            "#0284C7", "#E0F2FE", "#0369A1"
        ),
        (
            "STEP 2",
            "D8 Flow Routing & Accumulation",
            "terrain_analysis.py",
            "• Steepest descent flow direction to 8 neighbors:\n   d*(r,c) = argmax (Δz / distance)\n• Diagonal distance = √2, Orthogonal = 1.0\n• Upstream flow accumulation matrix A(r,c):\n   A(r,c) = 1 + Σ A(upstream neighbors)",
            "#0D9488", "#CCFBF1", "#0F766E"
        ),
        (
            "STEP 3",
            "River Detection & 150m Exclusion",
            "terrain_analysis.py",
            "• Active river threshold: Top 7th percentile of A(r,c)\n• Safety Exclusion: Ponds inside active channels fail\n• Morphological binary dilation with 6-cell radius:\n   Buffer width ≈ 150 meters around all stream beds\n• Masks out high-flood hazard zones",
            "#DC2626", "#FEE2E2", "#991B1B"
        ),
        (
            "STEP 4",
            "Reverse-BFS Catchment Delineation",
            "catchment.py",
            "• Identifies qualified local topographic depressions\n• Reverse Breadth-First Search (BFS) on D8 graph\n• Traverses upstream drainage backwards from depression:\n   W(r0, c0) = { (r,c) | flow terminates at (r0,c0) }\n• Total Catchment Area: A_catch = |W| × Cell_Area",
            "#7C3AED", "#EDE9FE", "#6D28D9"
        ),
        (
            "STEP 5",
            "Multi-Criteria Suitability Scoring",
            "pond_selector.py",
            "• Min-Max normalization across all candidate sites\n• Weighted Pareto suitability model:\n   Score = 0.45 · Catchment + 0.30 · (1 - Slope)\n                 + 0.25 · Depression_Depth\n• Spatial Non-Maximum Suppression (15-cell buffer)",
            "#D97706", "#FEF3C7", "#92400E"
        ),
        (
            "STEP 6",
            "Rational Runoff Sizing & Design",
            "pond_selector.py  →  geojson_builder.py",
            "• Real rainfall from Open-Meteo API (2018–2025)\n• Rational Method Runoff: Q = C · (P_annual/1000) · A_catch\n• Semi-arid rural runoff coefficient: C = 0.30\n• Target Storage: V_target = 0.50 × Q (50% retention)\n• Recommended Depth: D = 3.5m (includes 0.5m freeboard)",
            "#16A34A", "#DCFCE7", "#15803D"
        )
    ]

    # Background canvas card
    canvas = patches.FancyBboxPatch((2, 2), 96, 96, boxstyle="round,pad=0.8,rounding_size=1.5",
                                    edgecolor="#CBD5E1", facecolor="#F8FAFC", linewidth=1.5)
    ax.add_patch(canvas)

    # Header Banner
    ax.text(50, 93.5, "HydroPond.ai — End-to-End Hydrological Algorithm Pipeline",
            fontsize=13, fontweight='bold', ha='center', va='center', color=c_title)
    ax.text(50, 90.5, "Scientific computation workflow: From raw elevation contours to ranked, sized village percolation ponds",
            fontsize=8.5, fontstyle='italic', ha='center', va='center', color="#475569")

    # Layout: 2 rows of 3 columns
    # Row 1 (Steps 1, 2, 3) at y = 51 to 86
    # Row 2 (Steps 6, 5, 4) at y = 8 to 43 (U-shaped pipeline flow)
    positions = [
        (4.5, 52, 27.5, 34),   # Step 1
        (36.25, 52, 27.5, 34), # Step 2
        (68, 52, 27.5, 34),    # Step 3
        (68, 10, 27.5, 34),    # Step 4 (directly below Step 3)
        (36.25, 10, 27.5, 34), # Step 5 (below Step 2)
        (4.5, 10, 27.5, 34)    # Step 6 (below Step 1)
    ]

    for idx, (step_num, title, module, details, border_c, bg_header, text_c) in enumerate(steps):
        x, y, w, h = positions[idx]

        # Main box
        card = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.4,rounding_size=1",
                                      edgecolor=border_c, facecolor="#FFFFFF", linewidth=1.4)
        ax.add_patch(card)

        # Header Pill
        header = patches.FancyBboxPatch((x, y + h - 8.5), w, 8.5, boxstyle="round,pad=0.4,rounding_size=1",
                                        edgecolor=border_c, facecolor=bg_header, linewidth=1.2)
        ax.add_patch(header)

        # Step tag & Title
        ax.text(x + 1.8, y + h - 3, step_num, fontsize=8, fontweight='bold', color=text_c)
        ax.text(x + w - 1.8, y + h - 3, module, fontsize=6.8, fontstyle='italic', ha='right', color="#64748B")
        ax.text(x + 1.8, y + h - 6.5, title, fontsize=8.8, fontweight='bold', color="#0F172A")

        # Detail text
        ax.text(x + 1.8, y + h - 11.5, details, fontsize=7.4, va='top', color="#334155", linespacing=1.4)

    # Connecting Flow Arrows between steps
    arrow_style = dict(arrowstyle="->,head_width=0.4,head_length=0.6", color=c_arrow, lw=2.2)

    # Step 1 -> Step 2
    ax.annotate('', xy=(36, 69), xytext=(32.2, 69), arrowprops=arrow_style)

    # Step 2 -> Step 3
    ax.annotate('', xy=(67.8, 69), xytext=(64, 69), arrowprops=arrow_style)

    # Step 3 -> Step 4 (Downwards)
    ax.annotate('', xy=(81.75, 44.5), xytext=(81.75, 51.5), arrowprops=arrow_style)

    # Step 4 -> Step 5 (Leftwards)
    ax.annotate('', xy=(64, 27), xytext=(67.8, 27), arrowprops=arrow_style)

    # Step 5 -> Step 6 (Leftwards)
    ax.annotate('', xy=(32.2, 27), xytext=(36, 27), arrowprops=arrow_style)

    # Final output banner on bottom of Step 6
    ax.text(18.25, 4.5, "➔ Ready for Leaflet Web-GIS Map Display & GeoJSON Export",
            fontsize=7.8, fontweight='bold', ha='center', va='center', color="#15803D",
            bbox=dict(boxstyle="round,pad=0.25", facecolor="#DCFCE7", edgecolor="#86EFAC", lw=0.8))

    plt.tight_layout()
    plt.savefig("/Users/harshita/Desktop/venv/csd_pond/fig_algorithm_pipeline.png", dpi=300, bbox_inches='tight')
    print("Algorithm pipeline diagram successfully created!")

if __name__ == "__main__":
    draw_algorithm_pipeline()
