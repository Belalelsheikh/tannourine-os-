-- Security advisor 0011: pin geo_distance_m's search_path. It references no tables, so empty is safe.
alter function public.geo_distance_m(double precision, double precision, double precision, double precision) set search_path = '';
