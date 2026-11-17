/**
 * Where each geography tag of the taxonomy sits on the map
 * (`fixtures/accelerators/taxonomy.json`, facet "geography"): one or more
 * [longitude, latitude] points, and for a country or a region its rough extent
 * as a radius in degrees. A city has no extent: it is a pin. A tag added to the
 * taxonomy without an entry here is still listed, just not drawn.
 */
export interface Place {
    points: readonly (readonly [number, number])[];
    radius: number;
}

const city = (longitude: number, latitude: number): Place => ({
    points: [[longitude, latitude]],
    radius: 0,
});
const area = (longitude: number, latitude: number, radius: number): Place => ({
    points: [[longitude, latitude]],
    radius,
});

export const PLACES: Readonly<Record<string, Place>> = {
    "geography.africa": area(20, 3, 26),
    "geography.bay-area": city(-122.27, 37.8),
    "geography.boston": city(-71.06, 42.36),
    "geography.canada": area(-98, 56, 13),
    "geography.central-eastern-europe": area(22, 49, 7),
    "geography.chicago": city(-87.63, 41.88),
    "geography.east-asia": area(122, 35, 12),
    "geography.europe": area(12, 50, 12),
    "geography.france": area(2.4, 46.6, 3.5),
    "geography.germany": area(10.4, 51.2, 3),
    "geography.iberia": area(-4, 40, 4),
    "geography.india": area(79, 22, 8),
    "geography.ireland": area(-8, 53.4, 1.8),
    "geography.israel": city(34.8, 32.08),
    "geography.latin-america": area(-62, -12, 24),
    "geography.london": city(-0.13, 51.51),
    "geography.london-bangalore-san-francisco": {
        points: [
            [-0.13, 51.51],
            [77.59, 12.97],
            [-122.42, 37.77],
        ],
        radius: 0,
    },
    "geography.los-angeles": city(-118.24, 34.05),
    "geography.middle-east": area(25, 27, 17),
    "geography.netherlands": area(5.3, 52.1, 1.6),
    "geography.new-york": city(-74.01, 40.71),
    "geography.nordics": area(15, 63, 8),
    "geography.oceania": area(145, -30, 17),
    "geography.san-francisco": city(-122.42, 37.77),
    "geography.southeast-asia": area(110, 6, 13),
    "geography.switzerland": area(8.2, 46.8, 1.4),
    "geography.united-kingdom": area(-2, 54, 3.5),
    "geography.united-states": area(-98, 39, 15),
};
