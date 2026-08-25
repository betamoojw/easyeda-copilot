import type {
    PointMm,
    RoutedTrack,
    RoutedVia,
    RoutedZone,
    RoutingBoard,
    RoutingCopper,
    RoutingClearIntent,
    RoutingDiagnostic,
    RoutingPadShape,
    RoutingResult,
    RoutingRuleValues,
    RoutingRules,
} from 'eda-copilot-router';
import { validateRoutingBoard } from 'eda-copilot-router';

type JsonRecord = Record<string, unknown>;

export type EasyEdaAutorouteCaptureOptions = Readonly<{
    clearRouting?: RoutingClearIntent;
}>;

export type EasyEdaAutorouteImport = Readonly<{
    board?: RoutingBoard;
    diagnostics: readonly RoutingDiagnostic[];
}>;

export type EasyEdaRoutingApplication = Readonly<{
    copperLayerCount?: number;
    clearRouting?: RoutingClearIntent;
    tracks: readonly Readonly<{
        id?: string;
        net: string;
        layer: number;
        widthMm: number;
        points: readonly (readonly [number, number])[];
    }>[];
    vias: readonly Readonly<{
        id?: string;
        net: string;
        location: readonly [number, number];
        diameterMm: number;
        drillMm: number;
    }>[];
    zones: readonly Readonly<{
        id?: string;
        net: string;
        layers: readonly number[];
        outline: readonly (readonly number[])[];
        holes: readonly (readonly (readonly number[])[])[];
        priority: number;
        minThicknessMm?: number;
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
    return x === undefined || y === undefined ? undefined : { x, y: y === 0 ? 0 : -y };
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
    // KRT expects KiCad's canonical copper-layer names internally.  The DSL
    // remains EDA-neutral: TOP/BOTTOM/INNER_n selectors are resolved by layer
    // side/index, and routing results are translated back to EasyEDA IDs.
    if (id === 1) return 'F.Cu';
    if (id === 2) return 'B.Cu';
    if (id >= 15 && id <= 44) return `In${id - 14}.Cu`;
    return undefined;
}

function layerId(name: string) {
    if (name === 'F.Cu' || name === 'TOP') return 1;
    if (name === 'B.Cu' || name === 'BOTTOM') return 2;
    const inner = /^(?:In(\d+)\.Cu|INNER_(\d+))$/.exec(name);
    return inner ? 14 + Number(inner[1] ?? inner[2]) : undefined;
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

function rectangularPadShape(ring: readonly PointMm[]): RoutingPadShape | undefined {
    if (ring.length !== 4) return undefined;
    const xs = ring.map(item => item.x);
    const ys = ring.map(item => item.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const widthMm = maxX - minX;
    const heightMm = maxY - minY;
    if (widthMm <= 0 || heightMm <= 0) return undefined;

    // EasyEDA's polygon coordinates occasionally carry a few nanometres of
    // numeric drift around the declared pad centre.  Keep a true offset or a
    // non-rectangular quadrilateral as custom geometry, but encode ordinary
    // rectangles with KiCad's native pad shape.  KRT's subtractive cleanup is
    // substantially more reliable with native terminal geometry.
    const tolerance = Math.max(1e-4, Math.max(widthMm, heightMm) * 1e-5);
    if (Math.abs(minX + maxX) / 2 > tolerance || Math.abs(minY + maxY) / 2 > tolerance) {
        return undefined;
    }
    const corners = new Set(ring.map(item => {
        const x = Math.abs(item.x - minX) <= tolerance ? 0
            : Math.abs(item.x - maxX) <= tolerance ? 1 : -1;
        const y = Math.abs(item.y - minY) <= tolerance ? 0
            : Math.abs(item.y - maxY) <= tolerance ? 1 : -1;
        return `${x}:${y}`;
    }));
    if (corners.size !== 4 || [...corners].some(corner => corner.startsWith('-1') || corner.endsWith(':-1'))) {
        return undefined;
    }
    return { kind: 'rect', widthMm, heightMm };
}

function importedPadShape(pad: JsonRecord, localAt: PointMm): RoutingPadShape | undefined {
    const diameterMm = finite(pad.diameter);
    if (diameterMm !== undefined && diameterMm > 0) {
        return { kind: 'circle', diameterMm };
    }

    const ring = openRing(path(pad.path)).map(item => ({
        x: item.x - localAt.x,
        y: item.y - localAt.y,
    }));
    return rectangularPadShape(ring) ?? (ring.length >= 3
        ? { kind: 'polygon', polygon: { outer: ring } }
        : undefined);
}

function strictMaximum(values: readonly (number | undefined)[], fallback: number) {
    const finiteValues = values.filter((value): value is number => value !== undefined);
    return finiteValues.length ? Math.max(...finiteValues) : fallback;
}

function ruleForNet(root: JsonRecord, net: JsonRecord, differentialMember: boolean): RoutingRuleValues {
    const rules = record(root.rules) ?? {};
    const clearanceRule = firstRecord(record(rules.safeClearances)?.[String(net.safeClearance ?? '')]);
    const widthRule = firstRecord(record(rules.trackWidths)?.[String(net.trackWidth ?? '')]);
    const via = numberList(record(rules.viaSizes)?.[String(net.viaSize ?? '')]);
    // EasyEDA assigns a differential-rule preset to ordinary nets too. Pair
    // membership is defined only by classes.differentialPairClasses.
    const differentialRule = differentialMember
        ? firstRecord(record(rules.differentialPairs)?.[String(net.differentialPair ?? '')])
        : undefined;
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
        // EasyEDA keys this object by schematic designator (J1, U1, ...).
        // component.name is the library/MPN display name and is not unique.
        const designator = componentKey;
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
            const shape = importedPadShape(pad, localAt);
            const net = text(componentNets[padKey]);
            if (net) netNames.add(net);
            const padLayers = layerIds(pad.layers);
            if (!shape || !padLayers.length) {
                diagnostics.push({
                    code: 'EASYEDA_PAD_GEOMETRY_INVALID', severity: 'error',
                    message: `${designator}.${String(pinNames[padKey] ?? pad.number ?? padKey)} has unsupported geometry.`,
                });
                continue;
            }
            pads.push({
                id: `${designator}:${padKey}`,
                component: designator,
                // footprint pad numbers are the canonical DSL identity.
                // component.pinName may contain display labels such as VIN,
                // Ground, A, or K rather than the numeric pad number.
                number: String(pad.number ?? pinNames[padKey] ?? padKey),
                ...(net ? { net } : {}),
                at: atPad,
                rotationDeg,
                layers: padLayers,
                shape,
            });
        }
    }
    const netEntries = records(root.nets);
    for (const entry of netEntries) {
        const name = text(entry.net);
        if (name) netNames.add(name);
    }
    const differentialPairs = Object.entries(record(record(root.classes)?.differentialPairClasses) ?? {})
        .flatMap(([id, members]) => {
            const nets = (Array.isArray(members) ? members : []).map(text)
                .filter((item): item is string => Boolean(item));
            if (nets.length !== 2 || nets[0] === nets[1]) {
                diagnostics.push({
                    code: 'EASYEDA_DIFF_PAIR_INVALID', severity: 'error',
                    message: `Differential pair class ${id} must contain exactly two distinct nets.`,
                });
                return [];
            }
            return [{ id, positive: nets[0], negative: nets[1] }];
        });
    const differentialMembers = new Set(differentialPairs.flatMap(pair => [pair.positive, pair.negative]));
    const perNetValues = new Map<string, RoutingRuleValues>();
    for (const net of netEntries) {
        const name = text(net.net);
        if (name) perNetValues.set(name, ruleForNet(root, net, differentialMembers.has(name)));
    }
    const fallback = defaultRules([...perNetValues.values()]);
    const rules: RoutingRules = {
        default: fallback,
        nets: [...netNames].sort().map(net => ({ net, values: perNetValues.get(net) ?? fallback })),
        ...(differentialPairs.length ? { differentialPairs } : {}),
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
    for (const zone of zones) if (zone.net) netNames.add(zone.net);
    const importedCopper: RoutingCopper = { tracks: importedTracks, vias: importedVias, zones };
    const selectedForClear = (net: string | undefined, item: keyof RoutingClearIntent) => {
        const nets = options.clearRouting?.[item];
        return net !== undefined && (nets === 'all' || Boolean(nets?.includes(net)));
    };
    const editable: RoutingCopper = {
        tracks: importedCopper.tracks.filter(item => selectedForClear(item.net, 'tracks')),
        vias: importedCopper.vias.filter(item => selectedForClear(item.net, 'vias')),
        zones: importedCopper.zones.filter(item => selectedForClear(item.net, 'zones')),
    };
    const fixed: RoutingCopper = {
        tracks: importedCopper.tracks.filter(item => !selectedForClear(item.net, 'tracks')),
        vias: importedCopper.vias.filter(item => !selectedForClear(item.net, 'vias')),
        zones: importedCopper.zones.filter(item => !selectedForClear(item.net, 'zones')),
    };
    const board: RoutingBoard = {
        outline,
        cutouts: [],
        layers,
        nets: [...netNames].sort().map(name => ({ name })),
        components,
        pads,
        keepouts: importedKeepouts(root, layerNames, diagnostics),
        rules,
        copper: options.clearRouting ? { fixed, editable } : { fixed: importedCopper, editable: EMPTY_COPPER },
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
    let copperLayerCount: number | undefined;
    if (result.stackup?.applyRequested) {
        const requested = result.stackup.effective.layers.filter(layer => layer.kind === 'copper').length;
        if (requested < 2 || requested > 32 || requested % 2 !== 0) {
            diagnostics.push({
                code: 'EASYEDA_STACKUP_COPPER_LAYER_COUNT_UNSUPPORTED',
                severity: 'error',
                message: `EasyEDA requires an even copper layer count from 2 to 32; router requested ${requested}.`,
            });
        } else {
            copperLayerCount = requested;
            diagnostics.push({
                code: 'EASYEDA_STACKUP_LAYER_COUNT_ONLY',
                severity: 'warning',
                message: `EasyEDA will apply the ${requested}-layer copper count; physical thickness and material properties remain managed by the open board.`,
            });
        }
    }
    if (!result.copper) return {
        ...(copperLayerCount === undefined ? {} : { copperLayerCount }),
        tracks: [],
        vias: [],
        zones: [],
        ...(result.clearRouting ? { clearRouting: result.clearRouting } : {}),
        rules: result.rules,
        diagnostics: [...result.diagnostics, ...diagnostics],
    };
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
            id: track.id,
            layer,
            net: track.net,
            widthMm: track.widthMm,
            points: track.points.map(toEasyEdaPoint),
        }];
    });
    const vias = result.copper.vias.flatMap((via, index) => {
        if (via.type && via.type !== 'through') {
            diagnostics.push({
                code: 'EASYEDA_RESULT_VIA_TYPE_UNSUPPORTED', severity: 'error',
                message: `Via ${via.id ?? index} uses unsupported EasyEDA via type ${via.type}.`,
            });
            return [];
        }
        return [{
            id: via.id,
            location: toEasyEdaPoint(via.at),
            net: via.net,
            diameterMm: via.diameterMm,
            drillMm: via.drillMm,
        }];
    });
    const zones = result.copper.zones.flatMap((zone, index) => {
        if (!zone.net) {
            diagnostics.push({
                code: 'EASYEDA_RESULT_ZONE_NET_REQUIRED', severity: 'error',
                message: `Zone ${zone.id ?? index} has no electrical net and cannot be applied safely in EasyEDA.`,
            });
            return [];
        }
        if (zone.outline.holes?.length) {
            diagnostics.push({
                code: 'EASYEDA_RESULT_ZONE_HOLES_UNSUPPORTED', severity: 'error',
                message: `Zone ${zone.id ?? index} contains holes that the EasyEDA host adapter cannot preserve.`,
            });
            return [];
        }
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
            holes: [],
            priority: zone.priority ?? 0,
            minThicknessMm: zone.minThicknessMm,
        }];
    });
    return {
        ...(copperLayerCount === undefined ? {} : { copperLayerCount }),
        ...(result.clearRouting ? { clearRouting: result.clearRouting } : {}),
        tracks: traces,
        vias,
        zones,
        rules: result.rules,
        diagnostics: [...result.diagnostics, ...diagnostics],
    };
}
