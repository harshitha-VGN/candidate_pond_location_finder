# CSD Pond Planning API

This project is a Flask-based API for finding suitable pond locations from contour data provided as KML or KMZ files.

The application takes the contour information, creates a Digital Elevation Model (DEM), studies the terrain and direction of surface water flow, identifies possible catchment and pond locations, ranks the available locations, performs basic pond-size calculations, and returns the results in GeoJSON format for visualization.

## Features

- Supports `.kml` and `.kmz` contour files.
- Reads contour coordinates and elevation values.
- Builds a regular Digital Elevation Model (DEM).
- Calculates water flow using the D8 method.
- Calculates flow accumulation across the DEM.
- Identifies high-flow areas that may represent rivers or streams.
- Finds local minima that can act as water collection points.
- Determines upstream catchments using reverse BFS.
- Removes unsuitable pond locations using terrain and catchment conditions.
- Prevents multiple candidates from being placed too close together.
- Scores candidates using catchment area, slope, and depression depth.
- Uses historical rainfall data from Open-Meteo when available.
- Estimates runoff, storage capacity, and basic pond dimensions.
- Produces catchment polygons, pond-site polygons, and candidate points as GeoJSON.

## Analysis Pipeline

The application processes an uploaded contour file through several stages:

```text
KML / KMZ
    |
    v
KML Parser
    |
    v
Contour Coordinates + Elevations
    |
    v
DEM Builder
    |
    v
Digital Elevation Model
    |
    v
Terrain Analysis
    |
    +--> D8 Flow Direction
    +--> Flow Accumulation
    +--> River Detection
    +--> Depression Filling
    |
    v
Pond Candidate Detection
    |
    +--> Local Minima
    +--> River Exclusion
    +--> Catchment Delineation
    +--> Catchment Filtering
    |
    v
Candidate Selection
    |
    +--> Catchment Area
    +--> Slope
    +--> Depression Depth
    |
    v
Pond Design Estimation
    |
    +--> Rainfall
    +--> Runoff
    +--> Storage
    +--> Pond Size
    |
    v
GeoJSON Output
````

## File Description

### `app.py`

`app.py` is the main file of the project and starts the Flask server.

It receives the uploaded KML/KMZ file and controls the complete analysis process. It first checks the file type and size, reads the optional parameters, and then calls the other modules in the required order.

The main processing sequence is:

1. Read and validate the uploaded file.
2. Parse the contour information.
3. Generate the DEM.
4. Add the small DEM perturbation and calculate flow direction.
5. Calculate flow accumulation.
6. Detect river areas and create the river exclusion region.
7. Find pond candidates and their catchments.
8. Rank the candidates.
9. Generate the GeoJSON result.
10. Send the result back to the client.

The file also contains the following API routes:

* `GET /health`
* `POST /analyzeContour`

### `kml_parser.py`

This module handles the input contour file.

It can read both KML and KMZ files. When a KMZ file is supplied, it opens the archive and finds the KML file inside it.

The parser extracts the contour geometry and elevation. It supports:

* `LineString`
* `LinearRing`
* `Polygon`

Elevation is checked in several places so that different KML formats can be handled. It can come from the Placemark name, description, `SimpleData`, or the Z-coordinate.

There is also a folder-level fallback for KML files where the elevation is stored in the folder name.

The result from this module is a list containing the contour elevation and its coordinates.

### `dem_builder.py`

`dem_builder.py` takes the contour data from the parser and converts it into a regular elevation grid.

First, points are sampled along the contour lines. These points are then interpolated over the study area using `scipy.griddata`.

The module also:

1. Creates the regular grid.
2. Interpolates elevation values.
3. Uses nearest-neighbour interpolation where the first interpolation leaves gaps.
4. Smooths the resulting DEM using a Gaussian filter.
5. Calculates the approximate physical size of each grid cell.
6. Stores the geographic information needed by the later stages.

The output consists of the DEM array and metadata describing the grid.

### `terrain_analysis.py`

This module performs the main terrain and hydrological calculations.

It contains the following operations:

**DEM perturbation:**
A very small, reproducible amount of noise is added to the DEM. This helps avoid ambiguity when neighbouring cells have exactly the same elevation.

**D8 flow direction:**
Each grid cell checks its eight neighbouring cells and selects the direction with the greatest downward slope. A cell without a lower neighbour is treated as a local minimum.

**Flow accumulation:**
The flow network is processed from higher cells toward lower cells so that upstream contributions can be accumulated at downstream cells.

**Priority-Flood:**
Depressions in the DEM are filled to determine how deep the original depressions are.

**River detection:**
Cells with high flow accumulation are identified using the configured percentile threshold. Local minima are excluded from the river mask because they are collection points rather than locations where water continues downstream.

The module also calculates the slope of the terrain in degrees.

### `catchment.py`

`catchment.py` is responsible for finding potential pond locations and determining the area that drains toward each one.

The process starts by finding local minima in the flow-direction grid. These locations are possible natural collection points.

The module then removes locations that are not suitable, including areas affected by river exclusion, river/floodplain sinks, low elevation, or unsuitable catchment sizes.

For every remaining candidate, reverse BFS is used on the flow-direction grid. Instead of following water downstream, the search starts at the candidate and finds all cells that flow into it. These cells make up the candidate's upstream catchment.

The module calculates useful information for each candidate, such as:

* Catchment area
* Number of catchment cells
* Minimum elevation
* Maximum elevation
* Mean slope
* Depression depth
* Flow accumulation

A spatial suppression step is applied at the end so that candidates that are too close to one another are removed.

### `pond_selector.py`

This module takes the candidates generated by `catchment.py` and decides which ones are better suited for the final result.

Each candidate is given a score using:

* Catchment area
* Slope
* Depression depth

A larger catchment area and deeper depression contribute positively to the score, while a lower slope is preferred.

After ranking the candidates, the module estimates basic pond-design values.

It requests historical rainfall from the Open-Meteo Historical API. If the request is unsuccessful, the configured fallback rainfall value is used instead.

The calculations provide estimates for:

* Annual rainfall
* Annual runoff
* Target storage
* Recommended pond depth
* Pond surface area
* Approximate pond radius

Rainfall results are cached using rounded coordinates so that the same location does not require repeated API requests.

### `geojson_builder.py`

`geojson_builder.py` prepares the final output for mapping and visualization.

It creates a GeoJSON `FeatureCollection` containing the selected pond candidates.

For each candidate, the output can include:

1. **Catchment area** - the upstream watershed contributing flow to the candidate.
2. **Pond site** - the depression area selected for the pond-site polygon.
3. **Pond candidate** - a point representing the candidate's location.

The candidate point contains additional information such as rank, score, elevation, slope, depression depth, catchment area, rainfall, runoff, storage, and estimated pond dimensions.

The module also adds metadata containing information about the study area, DEM resolution, elevation range, number of contours, and coordinate reference system.

## Installation

Python 3.10 or newer is recommended.

Install the project dependencies using:

```bash
pip install -r requirements.txt
```

## Running the API

Start the Flask application with:

```bash
python app.py
```

The server will be available at:

```text
http://localhost:5000
```

## API Endpoints

### Health Check

```http
GET /health
```

This endpoint can be used to check whether the API is running.

Example response:

```json
{
    "status": "ok",
    "service": "CSD Pond Planning API",
    "version": "1.0"
}
```

### Analyze Contours

```http
POST /analyzeContour
```

The request uses `multipart/form-data`.

Required field:

```text
file = <KML or KMZ file>
```

Optional fields:

```text
top_n = 5
grid_res = 120
```

Example:

```bash
curl -X POST http://localhost:5000/analyzeContour \
  -F "file=@contours.kml" \
  -F "top_n=5" \
  -F "grid_res=120"
```

The response is a GeoJSON `FeatureCollection` containing the selected pond candidates and their associated information.

## Output

The generated GeoJSON contains information about the selected candidates, including:

* Candidate rank
* Candidate score
* Location
* Elevation
* Slope
* Depression depth
* Catchment area
* Catchment cell count
* Flow accumulation
* Annual rainfall
* Estimated annual runoff
* Runoff coefficient
* Recommended pond depth
* Estimated storage
* Estimated pond surface area
* Estimated pond radius

The GeoJSON can be opened in GIS or web-mapping applications to visualize the candidate pond locations and their catchment areas.

## Technologies Used

* Python
* Flask
* Flask-CORS
* NumPy
* SciPy
* scikit-image
* lxml
* Requests
* Open-Meteo Historical API

## Project Structure

```text
project/
│
├── app.py                  # Flask API and main processing pipeline            
├── kml_parser.py           # KML/KMZ parsing
├── dem_builder.py          # DEM generation
├── terrain_analysis.py     # Terrain and flow analysis
├── catchment.py            # Catchment and candidate detection
├── pond_selector.py        # Candidate ranking and pond estimates
├── geojson_builder.py      # GeoJSON generation
├── requirements.txt        # Python dependencies
├── .gitignore              # Files ignored by Git
└── README.md               # Project documentation
```
