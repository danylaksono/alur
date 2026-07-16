export type SpatialFunctionCategory = "Scalar" | "Aggregate" | "Macro" | "Table";

export interface SpatialFunctionMetadata {
  name: string;
  category: SpatialFunctionCategory;
  summary: string;
  requiredInputCount: number;
}

export const spatialFunctions: SpatialFunctionMetadata[] = [
  {
    "name": "DuckDB_PROJ_Compiled_Version",
    "summary": "Returns a text description of the PROJ library version that this instance of DuckDB was compiled against.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "DuckDB_Proj_Version",
    "summary": "Returns a text description of the PROJ library version that is being used by this instance of DuckDB.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Affine",
    "summary": "Applies an affine transformation to a geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Area",
    "summary": "Compute the area of a geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Area_Spheroid",
    "summary": "Returns the area of a geometry in meters, using an ellipsoidal model of the earth",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsGeoJSON",
    "summary": "Returns the geometry as a GeoJSON fragment",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsHEXWKB",
    "summary": "Returns the geometry as a HEXWKB string",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsMVTGeom",
    "summary": "Transform and clip geometry to a tile boundary",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsSVG",
    "summary": "Convert the geometry into a SVG fragment or path",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsText",
    "summary": "Returns the geometry as a WKT string",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsWKB",
    "summary": "Returns the geometry as a WKB (Well-Known-Binary) blob",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Azimuth",
    "summary": "Returns the azimuth (a clockwise angle measured from north) of two points in radian.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Boundary",
    "summary": "Returns the \"boundary\" of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Buffer",
    "summary": "Returns a buffer around the input geometry at the target distance",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_BuildArea",
    "summary": "Creates a polygonal geometry by attempting to \"fill in\" the input geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Centroid",
    "summary": "Returns the centroid of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Collect",
    "summary": "Collects a list of geometries into a collection geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_CollectionExtract",
    "summary": "Extracts geometries from a GeometryCollection into a typed multi geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ConcaveHull",
    "summary": "Returns the 'concave' hull of the input geometry, containing all of the source input's points, and which can be used to create polygons from points. The ratio parameter dictates the level of concavity; 1.0 returns the convex hull; and 0 indicates to return the most concave hull possible. Set allowHoles to a non-zero value to allow output containing holes.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Contains",
    "summary": "Returns true if the first geometry contains the second geometry",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_ContainsProperly",
    "summary": "Returns true if the first geometry \\\"properly\\\" contains the second geometry",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_ConvexHull",
    "summary": "Returns the convex hull enclosing the geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_CoverageInvalidEdges",
    "summary": "Returns the invalid edges in a polygonal coverage, which are edges that are not shared by two polygons.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_CoverageSimplify",
    "summary": "Simplify the edges in a polygonal coverage, preserving the coverage by ensuring that there are no seams between the resulting simplified polygons.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_CoverageUnion",
    "summary": "Union all geometries in a polygonal coverage into a single geometry.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_CoveredBy",
    "summary": "Returns true if geom1 is \"covered by\" geom2",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Covers",
    "summary": "Returns true if the geom1 \"covers\" geom2",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Crosses",
    "summary": "Returns true if geom1 \"crosses\" geom2",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_DWithin",
    "summary": "Returns if two geometries are within a target distance of each-other",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_DWithin_GEOS",
    "summary": "Returns if two geometries are within a target distance of each-other",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_DWithin_Spheroid",
    "summary": "Returns if two POINT_2D's are within a target distance in meters, using an ellipsoidal model of the earths surface",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Difference",
    "summary": "Returns the \"difference\" between two geometries",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Dimension",
    "summary": "Returns the \"topological dimension\" of a geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Disjoint",
    "summary": "Returns true if the geometries are disjoint",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Distance",
    "summary": "Returns the planar distance between two geometries",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Distance_GEOS",
    "summary": "Returns the planar distance between two geometries",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Distance_Sphere",
    "summary": "Returns the haversine (great circle) distance between two geometries.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Distance_Spheroid",
    "summary": "Returns the distance between two geometries in meters using an ellipsoidal model of the earths surface",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Dump",
    "summary": "Dumps a geometry into a list of sub-geometries and their \"path\" in the original geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_EndPoint",
    "summary": "Returns the end point of a LINESTRING.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Envelope",
    "summary": "Returns the minimum bounding rectangle of a geometry as a polygon geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Equals",
    "summary": "Returns true if the geometries are \"equal\"",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Extent",
    "summary": "Returns the minimal bounding box enclosing the input geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Extent_Approx",
    "summary": "Returns the approximate bounding box of a geometry, if available.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ExteriorRing",
    "summary": "Returns the exterior ring (shell) of a polygon geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_FlipCoordinates",
    "summary": "Returns a new geometry with the coordinates of the input geometry \"flipped\" so that x = y and y = x",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Force2D",
    "summary": "Forces the vertices of a geometry to have X and Y components",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Force3DM",
    "summary": "Forces the vertices of a geometry to have X, Y and M components",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Force3DZ",
    "summary": "Forces the vertices of a geometry to have X, Y and Z components",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Force4D",
    "summary": "Forces the vertices of a geometry to have X, Y, Z and M components",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeomFromGeoJSON",
    "summary": "Deserializes a GEOMETRY from a GeoJSON fragment.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeomFromHEXEWKB",
    "summary": "Deserialize a GEOMETRY from a HEX(E)WKB encoded string",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeomFromHEXWKB",
    "summary": "Deserialize a GEOMETRY from a HEX(E)WKB encoded string",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeomFromText",
    "summary": "Deserialize a GEOMETRY from a WKT encoded string",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeomFromWKB",
    "summary": "Deserializes a GEOMETRY from a WKB encoded blob",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeometryType",
    "summary": "Returns a 'GEOMETRY_TYPE' enum identifying the input geometry type. Possible enum return types are: `POINT`, `LINESTRING`, `POLYGON`, `MULTIPOINT`, `MULTILINESTRING`, `MULTIPOLYGON` and `GEOMETRYCOLLECTION`.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_HasM",
    "summary": "Check if the input geometry has M values.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_HasZ",
    "summary": "Check if the input geometry has Z values.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Hilbert",
    "summary": "Encodes the X and Y values as the hilbert curve index for a curve covering the given bounding box.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_InterpolatePoint",
    "summary": "Computes the closest point on a LINESTRING to a given POINT and returns the interpolated M value of that point.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Intersection",
    "summary": "Returns the intersection of two geometries",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Intersects",
    "summary": "Returns true if the geometries intersect",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Intersects_Extent",
    "summary": "Returns true if the extent of two geometries intersects",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_IsClosed",
    "summary": "Check if a geometry is 'closed'",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_IsEmpty",
    "summary": "Returns true if the geometry is \"empty\".",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_IsRing",
    "summary": "Returns true if the geometry is a ring (both ST_IsClosed and ST_IsSimple).",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_IsSimple",
    "summary": "Returns true if the geometry is simple",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_IsValid",
    "summary": "Returns true if the geometry is valid",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Length",
    "summary": "Returns the length of the input line geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Length_Spheroid",
    "summary": "Returns the length of the input geometry in meters, using an ellipsoidal model of the earth",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_LineInterpolatePoint",
    "summary": "Returns a point interpolated along a line at a fraction of total 2D length.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_LineInterpolatePoints",
    "summary": "Returns a multi-point interpolated along a line at a fraction of total 2D length.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_LineLocatePoint",
    "summary": "Returns the location on a line closest to a point as a fraction of the total 2D length of the line.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_LineMerge",
    "summary": "\"Merges\" the input line geometry, optionally taking direction into account.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_LineString2DFromWKB",
    "summary": "Deserialize a LINESTRING_2D from a WKB encoded blob",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_LineSubstring",
    "summary": "Returns a substring of a line between two fractions of total 2D length.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_LocateAlong",
    "summary": "Returns a point or multi-point, containing the point(s) at the geometry with the given measure",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_LocateBetween",
    "summary": "Returns a geometry or geometry collection created by filtering and interpolating vertices within a range of \"M\" values",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_M",
    "summary": "Returns the M coordinate of a point geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MMax",
    "summary": "Returns the maximum M coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MMin",
    "summary": "Returns the minimum M coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MakeBox2D",
    "summary": "Create a BOX2D from two POINT geometries",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MakeEnvelope",
    "summary": "Create a rectangular polygon from min/max coordinates",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MakeLine",
    "summary": "Create a LINESTRING from a list of POINT geometries",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MakePoint",
    "summary": "Creates a GEOMETRY point from an pair of floating point numbers.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MakePolygon",
    "summary": "Create a POLYGON from a LINESTRING shell",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MakeValid",
    "summary": "Returns a valid representation of the geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MaximumInscribedCircle",
    "summary": "Returns the maximum inscribed circle of the input geometry, optionally with a tolerance.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MinimumRotatedRectangle",
    "summary": "Returns the minimum rotated rectangle that bounds the input geometry, finding the surrounding box that has the lowest area by using a rotated rectangle, rather than taking the lowest and highest coordinate values as per ST_Envelope().",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Multi",
    "summary": "Turns a single geometry into a multi geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_NGeometries",
    "summary": "Returns the number of component geometries in a collection geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_NInteriorRings",
    "summary": "Returns the number of interior rings of a polygon",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_NPoints",
    "summary": "Returns the number of vertices within a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Node",
    "summary": "Returns a \"noded\" MultiLinestring, produced by combining a collection of input linestrings and adding additional vertices where they intersect.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Normalize",
    "summary": "Returns the \"normalized\" representation of the geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_NumGeometries",
    "summary": "Returns the number of component geometries in a collection geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_NumInteriorRings",
    "summary": "Returns the number of interior rings of a polygon",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_NumPoints",
    "summary": "Returns the number of vertices within a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Overlaps",
    "summary": "Returns true if the geometries overlap",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Perimeter",
    "summary": "Returns the length of the perimeter of the geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Perimeter_Spheroid",
    "summary": "Returns the length of the perimeter in meters using an ellipsoidal model of the earths surface",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Point",
    "summary": "Creates a GEOMETRY point",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Point2D",
    "summary": "Creates a POINT_2D",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Point2DFromWKB",
    "summary": "Deserialize a POINT_2D from a WKB encoded blob",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Point3D",
    "summary": "Creates a POINT_3D",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Point4D",
    "summary": "Creates a POINT_4D",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_PointN",
    "summary": "Returns the n'th vertex from the input geometry as a point geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_PointOnSurface",
    "summary": "Returns a point guaranteed to lie on the surface of the geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Points",
    "summary": "Collects all the vertices in the geometry into a MULTIPOINT",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Polygon2DFromWKB",
    "summary": "Deserialize a POLYGON_2D from a WKB encoded blob",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Polygonize",
    "summary": "Returns a polygonized representation of the input geometries",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_QuadKey",
    "summary": "Compute the [quadkey](https://learn.microsoft.com/en-us/bingmaps/articles/bing-maps-tile-system) for a given lon/lat point at a given level.",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_ReducePrecision",
    "summary": "Returns the geometry with all vertices reduced to the given precision",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_RemoveRepeatedPoints",
    "summary": "Remove repeated points from a LINESTRING.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Reverse",
    "summary": "Returns the geometry with the order of its vertices reversed",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ShortestLine",
    "summary": "Returns the shortest line between two geometries",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Simplify",
    "summary": "Returns a simplified version of the geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_SimplifyPreserveTopology",
    "summary": "Returns a simplified version of the geometry that preserves topology",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_StartPoint",
    "summary": "Returns the start point of a LINESTRING.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_TileEnvelope",
    "summary": "The `ST_TileEnvelope` scalar function generates tile envelope rectangular polygons from specified zoom level and tile indices.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Touches",
    "summary": "Returns true if the geometries touch",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_Transform",
    "summary": "Transforms a geometry between two coordinate systems",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Union",
    "summary": "Returns the union of two geometries",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_VoronoiDiagram",
    "summary": "Returns the Voronoi diagram of the supplied MultiPoint geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Within",
    "summary": "Returns true if the first geometry is within the second",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_WithinProperly",
    "summary": "Returns true if the first geometry \\\"properly\\\" is contained by the second geometry",
    "category": "Scalar",
    "requiredInputCount": 2
  },
  {
    "name": "ST_X",
    "summary": "Returns the X coordinate of a point geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_XMax",
    "summary": "Returns the maximum X coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_XMin",
    "summary": "Returns the minimum X coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Y",
    "summary": "Returns the Y coordinate of a point geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_YMax",
    "summary": "Returns the maximum Y coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_YMin",
    "summary": "Returns the minimum Y coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Z",
    "summary": "Returns the Z coordinate of a point geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ZMFlag",
    "summary": "Returns a flag indicating the presence of Z and M values in the input geometry.",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ZMax",
    "summary": "Returns the maximum Z coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ZMin",
    "summary": "Returns the minimum Z coordinate of a geometry",
    "category": "Scalar",
    "requiredInputCount": 1
  },
  {
    "name": "ST_AsMVT",
    "summary": "Make a Mapbox Vector Tile from a set of geometries and properties",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_CoverageInvalidEdges_Agg",
    "summary": "Returns the invalid edges of a coverage geometry",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_CoverageSimplify_Agg",
    "summary": "Simplifies a set of geometries while maintaining coverage",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_CoverageUnion_Agg",
    "summary": "Unions a set of geometries while maintaining coverage",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Envelope_Agg",
    "summary": "Alias for [ST_Extent_Agg](#st_extent_agg).",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Extent_Agg",
    "summary": "Computes the minimal-bounding-box polygon containing the set of input geometries",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Intersection_Agg",
    "summary": "Computes the intersection of a set of geometries",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_MemUnion_Agg",
    "summary": "Computes the union of a set of input geometries.",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Union_Agg",
    "summary": "Computes the union of a set of input geometries",
    "category": "Aggregate",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Rotate",
    "summary": "Alias of ST_RotateZ",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_RotateX",
    "summary": "Rotates a geometry around the X axis. This is a shorthand macro for calling ST_Affine.",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_RotateY",
    "summary": "Rotates a geometry around the Y axis. This is a shorthand macro for calling ST_Affine.",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_RotateZ",
    "summary": "Rotates a geometry around the Z axis. This is a shorthand macro for calling ST_Affine.",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Scale",
    "summary": "",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_TransScale",
    "summary": "Translates and then scales a geometry in X and Y direction. This is a shorthand macro for calling ST_Affine.",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Translate",
    "summary": "",
    "category": "Macro",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Drivers",
    "summary": "Returns the list of supported GDAL drivers and file formats",
    "category": "Table",
    "requiredInputCount": 1
  },
  {
    "name": "ST_GeneratePoints",
    "summary": "Generates a set of random points within the specified bounding box.",
    "category": "Table",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Read",
    "summary": "Read and import a variety of geospatial file formats using the GDAL library.",
    "category": "Table",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ReadOSM",
    "summary": "The `ST_ReadOsm()` table function enables reading compressed OpenStreetMap data directly from a `.osm.pbf file.`",
    "category": "Table",
    "requiredInputCount": 1
  },
  {
    "name": "ST_ReadSHP",
    "summary": "Read a Shapefile without relying on the GDAL library",
    "category": "Table",
    "requiredInputCount": 1
  },
  {
    "name": "ST_Read_Meta",
    "summary": "Read the metadata from a variety of geospatial file formats using the GDAL library.",
    "category": "Table",
    "requiredInputCount": 1
  }
];

export const spatialFunctionsByCategory = spatialFunctions.reduce((acc, fn) => {
  acc[fn.category] = acc[fn.category] || [];
  acc[fn.category].push(fn);
  return acc;
}, {} as Record<SpatialFunctionCategory, SpatialFunctionMetadata[]>);

export const spatialFunctionCategories: SpatialFunctionCategory[] = ["Scalar", "Aggregate", "Macro", "Table"];