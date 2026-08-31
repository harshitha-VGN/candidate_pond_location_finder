"""
kml_parser.py - Parse KML / KMZ contour files.

Handles LineString, LinearRing and Polygon geometries.
Elevation can come from <name>, <description>, SimpleData or
the Z-coordinate in the geometry.
"""

import zipfile
import re
import logging

from lxml import etree


log = logging.getLogger(__name__)


def parse_kml_kmz(filepath: str) -> list[dict]:
    raw = _read(filepath)
    contours = _parse(raw)

    if not contours:
        raise ValueError(
            "No contour lines with elevation found. "
            "Ensure <name> or SimpleData carries the elevation value, "
            "or that Z-coordinates are non-zero."
        )

    contours.sort(
        key=lambda c: c["elevation"]
    )

    log.info(
        "Parsed %d contour lines  elev %.1f–%.1f m",
        len(contours),
        contours[0]["elevation"],
        contours[-1]["elevation"],
    )

    return contours


def _read(path: str) -> bytes:
    if path.lower().endswith(".kmz"):
        with zipfile.ZipFile(path) as z:
            names = [
                n
                for n in z.namelist()
                if n.lower().endswith(".kml")
            ]

            if not names:
                raise ValueError(
                    "No .kml inside KMZ archive."
                )

            # Prefer doc.kml when the archive contains multiple KML files.
            pick = next(
                (
                    n
                    for n in names
                    if "doc.kml" in n.lower()
                ),
                names[0],
            )

            return z.read(pick)

    return open(path, "rb").read()


def _parse(raw: bytes) -> list[dict]:
    try:
        root = etree.fromstring(raw)
    except etree.XMLSyntaxError as e:
        raise ValueError(f"Invalid XML: {e}")

    ns = _ns(root)

    pms = (
        root.findall(f".//{ns}Placemark")
        if ns
        else root.findall(".//Placemark")
    )

    log.info(
        "Found %d Placemarks",
        len(pms),
    )

    out = []

    for pm in pms:
        coords = _coords(pm, ns)

        if not coords or len(coords) < 2:
            continue

        elev = _elev(pm, ns) or _elev_z(pm, ns)

        if elev is not None:
            out.append({
                "elevation": float(elev),
                "coordinates": coords,
            })

    # Some KML files store the contour elevation at the folder level
    # instead of inside each individual Placemark.
    if not out:
        folders = (
            root.findall(f".//{ns}Folder")
            if ns
            else root.findall(".//Folder")
        )

        for folder in folders:
            fname = (
                folder.find(f"{ns}name")
                if ns
                else folder.find("name")
            )

            if fname is None or not fname.text:
                continue

            e = _num(fname.text)

            if e is None:
                continue

            placemarks = (
                folder.findall(f"{ns}Placemark")
                if ns
                else folder.findall("Placemark")
            )

            for pm in placemarks:
                c = _coords(pm, ns)

                if c and len(c) >= 2:
                    out.append({
                        "elevation": float(e),
                        "coordinates": c,
                    })

    return out


def _ns(root) -> str:
    t = root.tag

    return (
        "{" + t[1:].split("}")[0] + "}"
        if t.startswith("{")
        else ""
    )


def _elev(pm, ns) -> float | None:
    tags = (
        [f"{ns}name", f"{ns}description"]
        if ns
        else ["name", "description"]
    )

    for tag in tags:
        el = pm.find(tag)

        if el is not None and el.text:
            v = _num(el.text.strip())

            if v is not None:
                return v

    for el in pm.iter():
        local = (
            el.tag.split("}")[-1]
            if "}" in el.tag
            else el.tag
        )

        if local == "SimpleData":
            attr = el.get(
                "name",
                "",
            ).upper()

            if any(
                k in attr
                for k in (
                    "ELEV",
                    "HEIGHT",
                    "ALT",
                    "CONTOUR",
                )
            ):
                if el.text:
                    v = _num(el.text)

                    if v is not None:
                        return v

    return None


def _elev_z(pm, ns) -> float | None:
    paths = [
        (
            f".//{ns}LineString/{ns}coordinates"
            if ns
            else ".//LineString/coordinates"
        ),
        (
            f".//{ns}LinearRing/{ns}coordinates"
            if ns
            else ".//LinearRing/coordinates"
        ),
    ]

    for path in paths:
        el = pm.find(path)

        if el is not None and el.text:
            for tok in el.text.strip().split():
                parts = tok.split(",")

                if len(parts) >= 3:
                    try:
                        z = float(parts[2])

                        if z != 0.0:
                            return z

                    except ValueError:
                        pass

    return None


def _coords(pm, ns) -> list[tuple]:
    paths = [
        (
            f".//{ns}LineString/{ns}coordinates"
            if ns
            else ".//LineString/coordinates"
        ),
        (
            f".//{ns}LinearRing/{ns}coordinates"
            if ns
            else ".//LinearRing/coordinates"
        ),
        (
            f".//{ns}Polygon/{ns}outerBoundaryIs/"
            f"{ns}LinearRing/{ns}coordinates"
            if ns
            else ".//Polygon/outerBoundaryIs/"
                 "LinearRing/coordinates"
        ),
    ]

    for path in paths:
        el = pm.find(path)

        if el is not None and el.text:
            pts = []

            for tok in el.text.strip().split():
                p = tok.split(",")

                if len(p) >= 2:
                    try:
                        pts.append((
                            float(p[0]),
                            float(p[1]),
                        ))
                    except ValueError:
                        pass

            if pts:
                return pts

    return []


def _num(text: str) -> float | None:
    try:
        return float(text.strip())

    except ValueError:
        m = re.search(
            r"[-+]?\d+(?:\.\d+)?",
            text,
        )

        return float(m.group()) if m else None