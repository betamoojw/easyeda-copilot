import type {
    PointMm,
    RoutedTrack,
    RoutedVia,
    RoutedZone,
    RoutingBoard,
    RoutingCopper,
    RoutingDiagnostic,
    RoutingResult,
    RoutingRuleValues,
    RoutingRules,
} from '@easyeda-copilot/router';
import { validateRoutingBoard } from '@easyeda-copilot/router';

type JsonRecord = Record<string, unknown>;

export type EasyEdaAutorouteCaptureOptions = Readonly<{
    existingCopper?: 'fixed' | 'editable';
}>;

export type EasyEdaAutorouteImport = Readonly<{
    board?: RoutingBoard;
    diagnostics: readonly RoutingDiagnostic[];
}>;

export type EasyEdaRoutingApplication = Readonly<{
    /** Payload accepted by pcb_Document.importAutoRouteJsonFile. */
    autorouteResult?: Readonly<{
        progress: 1;
        routabitity: number;
        traces: readonly JsonRecord[];
        vias: readonly JsonRecord[];
    }>;
    /** Host-native pours created after autoroute trace/via import. */
    zones: readonly Readonly<{
        id?: string;
        net: string;
        layers: readonly number[];
        outline: readonly (readonly number[])[];
        holes: readonly (readonly (readonly number[])[])[];
        priority: number;
        minThicknessMm?: number;
        connection?: string;
    }>[];
    rules: RoutingResult['rules'];
    diagnostics: readonly RoutingDiagnostic[];
}>;

const EMPTY_COPPER: RoutingCopper = { tracks: [], vias: [], zones: [] };

function record(value: unknown): JsonRecord | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as JsonRecord
        : undefined;
}

function records(value: unknown): JsonRecord[] {
    return Array.isArray(value) ? value.map(record).filter((item): item is JsonRecord => Boolean(item)) : [];
}

function finite(value: unknown): number | undefined {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function point(value: unknown): PointMm | undefined {
    if (!Array.isArray(value) || value.length < 2) return undefined;
    const x = finite(value[0]);
    const y = finite(value[1]);
    return x === undefined || y === undefined ? undefined : { x, y: -y };
}

function path(value: unknown) {
    return (Array.isArray(value) ? value : [])
        .map(point)
        .filter((item): item is PointMm => Boolean(item));
}

function openRing(points: readonly PointMm[]) {
    const output = [...points];
    if (output.length > 1 && Math.hypot(
        output[0].x - output.at(-1)!.x,
        output[0].y - output.at(-1)!.y,
    ) < 1e-8) output.pop();
    return output;
}

function rotate(pointValue: PointMm, degrees: number): PointMm {
    const radians = degrees * Math.PI / 180;
    const cosine = Math.cos(radians);
    const sine = Math.sin(radians);
    const snap = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
    return {
        x: snap(pointValue.x * cosine - pointValue.y * sine),
        y: snap(pointValue.x * sine + pointValue.y * cosine),
    };
}

function internalLayerName(id: number) {
    if (id === 1) return 'TOP';
    if (id === 2) return 'BOTTOM';
    if (id >= 15 && id <= 44) return `INNER_${id - 14}`;
    return undefined;
}

function layerId(name: string) {
    if (name === 'TOP') return 1;
    if (name === 'BOTTOM') return 2;
    const inner = /^INNER_(\d+)$/.exec(name);
    return inner ? 14 + Number(inner[1]) : undefined;
}

function layerIds(value: unknown) {
    return (Array.isArray(value) ? value : [])
        .map(finite)
        .filter((item): item is number => item !== undefined)
        .map(internalLayerName)
        .filter((item): item is string => Boolean(item));
}

function numberList(value: unknown) {
    return (Array.isArray(value) ? value : [])
        .map(finite)
        .filter((item): item is number => item !== undefined);
}

function firstRecord(value: unknown) {
    return records(value)[0];
}

function strictMaximum(values: readonly (number | undefined)[], fallback: number) {
    const finiteValues = values.filter((value): value is number => value !== undefined);
    return finiteValues.length ? Math.max(...finiteValues) : fallback;
}

function ruleForNet(root: JsonRecord, net: JsonRecord): RoutingRuleValues {
    const rules = record(root.rules) ?? {};
    const clearanceRule = firstRecord(record(rules.safeClearances)?.[String(net.safeClearance ?? '')]);
    const widthRule = firstRecord(record(rules.trackWidths)?.[String(net.trackWidth ?? '')]);
    const via = numberList(record(rules.viaSizes)?.[String(net.viaSize ?? '')]);
    const differentialRule = firstRecord(record(rules.differentialPairs)?.[String(net.differentialPair ?? '')]);
    const widths = numberList(widthRule?.trackWidth);
    const differentialWidths = numberList(differentialRule?.width);
    const differentialGaps = numberList(differentialRule?.clearance);
    const clearance = strictMaximum([
        finite(clearanceRule?.trackToTrack), finite(clearanceRule?.trackToVia),
        finite(clearanceRule?.trackToPad), finite(clearanceRule?.viaToVia),
        finite(clearanceRule?.viaToPad),
    ], 0.2);
    const edgeClearance = strictMaximum([
        finite(clearanceRule?.trackToBoardOutline), finite(clearanceRule?.viaToBoardOutline),
    ], clearance);
    const minTrackWidth = widths[0] ?? differentialWidths[0] ?? 0.2;
    const preferredTrackWidth = widths[1] ?? widths.at(-1) ?? minTrackWidth;
    const diameter = via[0] ?? 0.6;
    const drill = via[1] ?? Math.min(0.3, diameter / 2);
    const allowedLayers = layerIds(widthRule?.layers);
    return {
        clearanceMm: clearance,
        edgeClearanceMm: edgeClearance,
        minTrackWidthMm: minTrackWidth,
        preferredTrackWidthMm: Math.max(minTrackWidth, preferredTrackWidth),
        via: {
            minDiameterMm: diameter,
            preferredDiameterMm: diameter,
            minDrillMm: drill,
            preferredDrillMm: drill,
        },
        ...(allowedLayers.length ? { allowedLayers } : {}),
        ...(differentialRule ? {
            differential: {
                trackWidthMm: differentialWidths[1] ?? differentialWidths[0] ?? preferredTrackWidth,
                gapMm: differentialGaps[0] ?? clearance,
                ...(finite(differentialRule.lengthTolerance) === undefined
                    ? {}
                    : { maxSkewMm: finite(differentialRule.lengthTolerance) }),
            },
        } : {}),
    };
}

function defaultRules(values: readonly RoutingRuleValues[]): RoutingRuleValues {
    const source = values.length ? values : [{
        clearanceMm: 0.2,
        edgeClearanceMm: 0.5,
        minTrackWidthMm: 0.2,
        preferredTrackWidthMm: 0.2,
        via: { minDiameterMm: 0.6, preferredDiameterMm: 0.6, minDrillMm: 0.3, preferredDrillMm: 0.3 },
    }];
    return {
        clearanceMm: Math.max(...source.map(item => item.clearanceMm)),
        edgeClearanceMm: Math.max(...source.map(item => item.edgeClearanceMm)),
        minTrackWidthMm: Math.max(...source.map(item => item.minTrackWidthMm)),
        preferredTrackWidthMm: Math.max(...source.map(item => item.preferredTrackWidthMm)),
        via: {
            minDiameterMm: Math.max(...source.map(item => item.via.minDiameterMm)),
            preferredDiameterMm: Math.max(...source.map(item => item.via.preferredDiameterMm)),
            minDrillMm: Math.max(...source.map(item => item.via.minDrillMm)),
            preferredDrillMm: Math.max(...source.map(item => item.via.preferredDrillMm)),
        },
    };
}

function importedZones(root: JsonRecord, layerNames: readonly string[], diagnostics: RoutingDiagnostic[]) {
    return records(root.fillRegions).flatMap((region, index): RoutedZone[] => {
        const net = text(region.net);
        const outer = openRing(path(region.path ?? region.outline));
        const layers = layerIds(region.layers ?? [region.layer]).filter(layer => layerNames.includes(layer));
        if (!net || outer.length < 3 || !layers.length) {
            diagnostics.push({
                code: 'EASYEDA_FILL_REGION_UNSUPPORTED', severity: 'warning',
                message: `fillRegions[${index}] could not be represented as fixed copper.`,
            });
            return [];
        }
        return [{ id: text(region.id), net, layers, outline: { outer }, connection: 'solid' }];
    });
}

function importedKeepouts(root: JsonRecord, layerNames: readonly string[], diagnostics: RoutingDiagnostic[]) {
    return records(root.prohibitedRegions).flatMap((region, index) => {
        const outer = openRing(path(region.path ?? region.outline));
        const layers = layerIds(region.layers ?? [region.layer]).filter(layer => layerNames.includes(layer));
        if (outer.length < 3 || !layers.length) {
            diagnostics.push({
                code: 'EASYEDA_PROHIBITED_REGION_UNSUPPORTED', severity: 'error',
                message: `prohibitedRegions[${index}] could not be represented safely.`,
            });
            return [];
        }
        return [{ id: text(region.id), layers, polygon: { outer }, forbid: { tracks: true, vias: true, zones: true } }];
    });
}

export function importEasyEdaAutorouteJson(
    value: unknown,
    options: EasyEdaAutorouteCaptureOptions = {},
): EasyEdaAutorouteImport {
    const diagnostics: RoutingDiagnostic[] = [];
    const root = record(value);
    if (!root) return {
        diagnostics: [{ code: 'EASYEDA_AUTOROUTE_JSON_INVALID', severity: 'error', message: 'Autoroute JSON must be an object.' }],
    };
    const outline = openRing(path(record(root.boardOutline)?.path));
    const routeLayerIds = numberList(record(root.layers)?.route);
    const notRouteLayerIds = numberList(record(root.layers)?.notRoute);
    const allLayerIds = [...new Set([...routeLayerIds, ...notRouteLayerIds])].sort((left, right) => {
        const rank = (id: number) => id === 1 ? 0 : id === 2 ? Number.MAX_SAFE_INTEGER : id - 13;
        return rank(left) - rank(right);
    });
    const layers = allLayerIds.flatMap((id, index) => {
        const name = internalLayerName(id);
        if (!name) return [];
        return [{ name, index, side: id === 1 ? 'top' as const : id === 2 ? 'bottom' as const : 'inner' as const }];
    });
    const layerNames = layers.map(layer => layer.name);
    const componentRecords = record(root.components) ?? {};
    const footprintRecords = record(root.footprints) ?? {};
    const components: RoutingBoard['components'][number][] = [];
    const pads: RoutingBoard['pads'][number][] = [];
    const netNames = new Set<string>();
    for (const [componentKey, componentValue] of Object.entries(componentRecords)) {
        const component = record(componentValue);
        if (!component) continue;
        const designator = text(component.name) ?? componentKey;
        const at = point(component.location);
        const rotationDeg = -(finite(component.rotation) ?? 0);
        if (!at) {
            diagnostics.push({ code: 'EASYEDA_COMPONENT_LOCATION_INVALID', severity: 'error', message: `${designator} has no valid location.` });
            continue;
        }
        const componentLayer = finite(component.layer) ?? 1;
        components.push({ designator, at, rotationDeg, side: componentLayer === 2 ? 'bottom' : 'top' });
        const footprint = record(footprintRecords[String(component.footprint ?? '')]);
        const footprintPads = record(footprint?.pads) ?? {};
        const componentNets = record(component.nets) ?? {};
        const pinNames = record(component.pinName) ?? {};
        for (const [padKey, padValue] of Object.entries(footprintPads)) {
            const pad = record(padValue);
            if (!pad) continue;
            const localAtYUp = point(pad.location);
            if (!localAtYUp) continue;
            // point() already reflected Y. Apply the same numeric clockwise
            // component rotation used by RoutingBoard's y-down convention.
            const localAt = localAtYUp;
            const placed = rotate(localAt, rotationDeg);
            const atPad = { x: at.x + placed.x, y: at.y + placed.y };
            const ring = openRing(path(pad.path)).map(item => ({
                x: item.x - localAt.x,
                y: item.y - localAt.y,
            }));
            const net = text(componentNets[padKey]);
            if (net) netNames.add(net);
            const padLayers = layerIds(pad.layers);
            if (ring.length < 3 || !padLayers.length) {
                diagnostics.push({
                    code: 'EASYEDA_PAD_GEOMETRY_INVALID', severity: 'error',
                    message: `${designator}.${String(pinNames[padKey] ?? pad.number ?? padKey)} has unsupported geometry.`,
                });
                continue;
            }
            pads.push({
                id: `${designator}:${padKey}`,
                component: designator,
                number: String(pinNames[padKey] ?? pad.number ?? padKey),
                ...(net ? { net } : {}),
                at: atPad,
                rotationDeg,
                layers: padLayers,
                shape: { kind: 'polygon', polygon: { outer: ring } },
            });
        }
    }
    const netEntries = records(root.nets);
    for (const entry of netEntries) {
        const name = text(entry.net);
        if (name) netNames.add(name);
    }
    const perNetValues = new Map<string, RoutingRuleValues>();
    for (const net of netEntries) {
        const name = text(net.net);
        if (name) perNetValues.set(name, ruleForNet(root, net));
    }
    const fallback = defaultRules([...perNetValues.values()]);
    const rules: RoutingRules = {
        default: fallback,
        nets: [...netNames].sort().map(net => ({ net, values: perNetValues.get(net) ?? fallback })),
    };
    const importedTracks: RoutedTrack[] = records(root.tracks).flatMap((track, index) => {
        const net = text(track.net);
        const layer = internalLayerName(finite(track.layer) ?? NaN);
        const points = path(track.path);
        const widthMm = finite(track.width);
        if (!net || !layer || !widthMm || points.length < 2) {
            diagnostics.push({ code: 'EASYEDA_TRACK_INVALID', severity: 'error', message: `tracks[${index}] is invalid.` });
            return [];
        }
        netNames.add(net);
        return [{ id: text(track.id), net, layer, widthMm, points }];
    });
    const top = layers.find(layer => layer.side === 'top')?.name;
    const bottom = layers.find(layer => layer.side === 'bottom')?.name;
    const importedVias: RoutedVia[] = records(root.vias).flatMap((via, index) => {
        const net = text(via.net);
        const at = point(via.location);
        const size = numberList(via.size);
        if (!net || !at || size.length < 2 || !top || !bottom) {
            diagnostics.push({ code: 'EASYEDA_VIA_INVALID', severity: 'error', message: `vias[${index}] is invalid.` });
            return [];
        }
        netNames.add(net);
        return [{
            id: text(via.id), net, at,
            diameterMm: size[0], drillMm: size[1],
            fromLayer: top, toLayer: bottom, type: 'through' as const,
        }];
    });
    const zones = importedZones(root, layerNames, diagnostics);
    for (const zone of zones) netNames.add(zone.net);
    const importedCopper: RoutingCopper = { tracks: importedTracks, vias: importedVias, zones };
    // EasyEDA apply replaces router-owned copper as one complete state, so
    // existing autoroute copper is editable by default and is returned again.
    const existingCopper = options.existingCopper ?? 'editable';
    const board: RoutingBoard = {
        outline,
        cutouts: [],
        layers,
        nets: [...netNames].sort().map(name => ({ name })),
        components,
        pads,
        keepouts: importedKeepouts(root, layerNames, diagnostics),
        rules,
        copper: existingCopper === 'fixed'
            ? { fixed: importedCopper, editable: EMPTY_COPPER }
            : { fixed: EMPTY_COPPER, editable: importedCopper },
    };
    const validation = validateRoutingBoard(board);
    diagnostics.push(...validation.diagnostics);
    return validation.ok && !diagnostics.some(item => item.severity === 'error')
        ? { board, diagnostics }
        : { diagnostics };
}

function toEasyEdaPoint(pointValue: PointMm) {
    return [pointValue.x, -pointValue.y] as const;
}

export function routingResultToEasyEdaApplication(result: RoutingResult): EasyEdaRoutingApplication {
    const diagnostics: RoutingDiagnostic[] = [];
    if (!result.copper) return { zones: [], rules: result.rules, diagnostics: result.diagnostics };
    const traces = result.copper.tracks.flatMap((track, index) => {
        const layer = layerId(track.layer);
        if (!layer) {
            diagnostics.push({
                code: 'EASYEDA_RESULT_LAYER_UNSUPPORTED', severity: 'error',
                message: `Track ${track.id ?? index} uses unsupported EasyEDA layer ${track.layer}.`,
            });
            return [];
        }
        return [{
            id: track.id ?? `routing-result-track-${index}`,
            layer,
            net: track.net,
            width: track.widthMm,
            path: track.points.map(toEasyEdaPoint),
        }];
    });
    const vias = result.copper.vias.map((via, index) => ({
        id: via.id ?? `routing-result-via-${index}`,
        location: toEasyEdaPoint(via.at),
        net: via.net,
        size: [via.diameterMm, via.drillMm],
    }));
    const zones = result.copper.zones.flatMap((zone, index) => {
        const layers = zone.layers.map(layerId).filter((item): item is number => item !== undefined);
        if (layers.length !== zone.layers.length) {
            diagnostics.push({
                code: 'EASYEDA_RESULT_ZONE_LAYER_UNSUPPORTED', severity: 'error',
                message: `Zone ${zone.id ?? index} contains an unsupported EasyEDA layer.`,
            });
            return [];
        }
        return [{
            id: zone.id,
            net: zone.net,
            layers,
            outline: zone.outline.outer.map(toEasyEdaPoint),
            holes: (zone.outline.holes ?? []).map(ring => ring.map(toEasyEdaPoint)),
            priority: zone.priority ?? 0,
            minThicknessMm: zone.minThicknessMm,
            connection: zone.connection,
        }];
    });
    return {
        autorouteResult: {
            progress: 1,
            routabitity: result.status === 'complete' ? 1 : 0,
            traces,
            vias,
        },
        zones,
        rules: result.rules,
        diagnostics: [...result.diagnostics, ...diagnostics],
    };
}
