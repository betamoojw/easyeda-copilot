export type PlacementPoint = {
    x: number;
    y: number;
};

export function easyEdaPointToPlacement(point: PlacementPoint, origin: PlacementPoint): PlacementPoint {
    return {
        x: roundCoordinate(point.x - origin.x),
        y: roundCoordinate(origin.y - point.y),
    };
}

function roundCoordinate(value: number) {
    return Math.round(value * 10) / 10;
}
