import { CircuitAssembly } from "@copilot/shared/types/circuit";
import { searchFreePlaceV2 } from "./free-place-searcher";
import { placeComponent } from "./place-component";
import { placeNet } from "./place-net";
import { getPrimitiveComponentPins } from "./search";
import { ECHOSYS_LIB, GND_PORT_COMPONENT, Offset, PlacedComponents, VCC_PORT_COMPONENT } from "./types";
import { getPageSize, normWireY, rmPartFromDesignator, to2, VERSION_EDASYEDA, yieldToEventLoop } from "./utils";
import { sch_PrimitiveWireSnap } from "./wire-snap";
import {
    appendDocumentSource,
    cloneSourceRecord,
    getMaxTicket,
    getMaxZIndex,
    makeSourceId,
    parseDocumentSource,
    SourceRecord,
} from "./source-document";

type AssemblyComponent = CircuitAssembly['components'][number];
type AssemblyEdge = CircuitAssembly['edges'][number];
type PrimitiveComponent = ISCH_PrimitiveComponent | ISCH_PrimitiveComponent$1;
type LegacyAssembler = (circuit: CircuitAssembly) => Promise<void>;

interface PlannedComponent {
    input: AssemblyComponent;
    layoutX: number;
    layoutY: number;
    apiX: number;
    apiY: number;
    templateKey: string;
    primitiveId?: string;
    pins?: ISCH_PrimitiveComponentPin[];
}

interface ComponentTemplate {
    seed: PlannedComponent;
    component: SourceRecord;
    attributes: SourceRecord[];
}

interface WireSpec {
    values: number[];
    net: string;
    description: string;
}

const applyOffset = (x: number, y: number, offset: Offset) => {
    if (offset.x) x += offset.x;
    if (offset.y) y = offset.y - y;
    return { x, y };
};

const getComponentLayoutPosition = (component: AssemblyComponent) => ({
    x: component.pos.x + (component.pos.center?.x ?? component.pos.width / 2),
    y: component.pos.y + (component.pos.center?.y ?? component.pos.height / 2),
});

const getSpecialSignalName = (component: AssemblyComponent) =>
    component.pins[0]?.signal_name || (component.part_uuid === 'GND' ? 'GND' : 'VCC');

const isNamedNetSymbol = (component: AssemblyComponent) =>
    component.part_uuid === 'GND' ||
    component.part_uuid === 'VCC' ||
    component.value === 'unknown_shortsym' ||
    component.designator.includes('|');

const getComponentTemplateKey = (component: AssemblyComponent) => JSON.stringify({
    partUuid: component.part_uuid,
    subPartName: component.sub_part_name ?? '',
    rotation: component.pos.rotate ?? 0,
    mirror: component.pos.mirror ?? false,
    kind: component.part_uuid === 'GND'
        ? 'GND'
        : component.part_uuid === 'VCC'
            ? 'VCC'
            : component.value === 'unknown_shortsym'
                ? 'UNKNOWN_SHORT'
                : component.designator.includes('|')
                    ? 'ECOSYSTEM_SHORT'
                    : 'DEVICE',
});

async function createSeedComponent(plan: PlannedComponent): Promise<PrimitiveComponent> {
    const component = plan.input;
    const partUuid = component.part_uuid;
    if (!partUuid) throw new Error(`Missing part_uuid for ${component.designator}`);

    const rotation = component.pos.rotate;
    const mirror = component.pos.mirror ?? false;
    let primitive: PrimitiveComponent | undefined;

    if (partUuid === 'GND') {
        primitive = await placeComponent(GND_PORT_COMPONENT, {
            x: plan.apiX,
            y: plan.apiY,
            rotate: rotation,
            mirror,
        });
    } else if (partUuid === 'VCC') {
        primitive = await placeComponent(VCC_PORT_COMPONENT, {
            x: plan.apiX,
            y: plan.apiY,
            rotate: rotation,
            mirror,
        });
    } else if (component.value === 'unknown_shortsym') {
        primitive = await placeComponent({ libraryUuid: 'lcsc', uuid: partUuid }, {
            x: plan.apiX,
            y: plan.apiY,
            rotate: rotation,
            mirror,
        });
    } else if (component.designator.includes('|')) {
        primitive = await placeComponent({ libraryUuid: ECHOSYS_LIB, uuid: partUuid }, {
            x: plan.apiX,
            y: plan.apiY,
            rotate: rotation,
            mirror,
        });
    } else {
        primitive = await placeComponent({ libraryUuid: 'lcsc', uuid: partUuid }, {
            x: plan.apiX,
            y: plan.apiY,
            rotate: rotation,
            mirror,
            subPartName: component.sub_part_name,
        });
        primitive = primitive.setState_Designator(rmPartFromDesignator(component.designator));
    }

    if (isNamedNetSymbol(component)) {
        const signalName = getSpecialSignalName(component);
        try {
            primitive.setState_Name(signalName);
            primitive.setState_OtherProperty({ "Global Net Name": signalName });
        } catch {
            // Some library symbols expose neither Name nor OtherProperty.
        }
    }

    const committed = await primitive.done();
    return (committed || primitive) as PrimitiveComponent;
}

function planComponents(circuit: CircuitAssembly, offset: Offset): PlannedComponent[] {
    return circuit.components
        .filter(component => Boolean(component.part_uuid))
        .map(input => {
            const layout = getComponentLayoutPosition(input);
            const api = applyOffset(layout.x, layout.y, offset);
            return {
                input,
                layoutX: layout.x,
                layoutY: layout.y,
                apiX: to2(api.x),
                apiY: to2(api.y),
                templateKey: getComponentTemplateKey(input),
            };
        });
}

function groupPlans(plans: PlannedComponent[]): Map<string, PlannedComponent[]> {
    const groups = new Map<string, PlannedComponent[]>();
    for (const plan of plans) {
        const group = groups.get(plan.templateKey) ?? [];
        group.push(plan);
        groups.set(plan.templateKey, group);
    }
    return groups;
}

async function placeSeeds(groups: Map<string, PlannedComponent[]>): Promise<void> {
    for (const group of groups.values()) {
        const seed = group[0];
        const primitive = await createSeedComponent(seed);
        seed.primitiveId = primitive.getState_PrimitiveId();
        eda.sys_Log.add(`[source-assemble] Seed ${seed.input.designator}: ${seed.primitiveId}`);
        await yieldToEventLoop();
    }
}

function collectComponentTemplates(
    records: SourceRecord[],
    groups: Map<string, PlannedComponent[]>,
): Map<string, ComponentTemplate> {
    const templates = new Map<string, ComponentTemplate>();

    for (const [key, group] of groups) {
        const seed = group[0];
        if (!seed.primitiveId) throw new Error(`Seed primitive id missing for ${seed.input.designator}`);

        const component = records.find(record =>
            record.outer.type === 'COMPONENT' && record.outer.id === seed.primitiveId,
        );
        if (!component?.inner) throw new Error(`Source COMPONENT not found for ${seed.input.designator}`);

        const attributes = records.filter(record =>
            record.outer.type === 'ATTR' && record.inner?.parentId === seed.primitiveId,
        );
        if (!attributes.length) throw new Error(`Source ATTR records not found for ${seed.input.designator}`);

        templates.set(key, { seed, component, attributes });
    }

    return templates;
}

function updateInstanceAttribute(inner: Record<string, unknown>, plan: PlannedComponent): void {
    const key = inner.key;
    if (key === 'Unique ID') inner.value = '';

    if (!isNamedNetSymbol(plan.input) && key === 'Designator') {
        inner.value = rmPartFromDesignator(plan.input.designator);
    }

    if (isNamedNetSymbol(plan.input) && (key === 'Name' || key === 'Global Net Name')) {
        inner.value = getSpecialSignalName(plan.input);
    }
}

function cloneComponentsIntoSource(
    source: string,
    records: SourceRecord[],
    groups: Map<string, PlannedComponent[]>,
    templates: Map<string, ComponentTemplate>,
): { source: string; addedCount: number } {
    let ticket = getMaxTicket(records);
    let zIndex = getMaxZIndex(records);
    const appended: SourceRecord[] = [];

    for (const [key, group] of groups) {
        const template = templates.get(key);
        if (!template?.component.inner) throw new Error(`Component template missing for ${key}`);

        for (const plan of group.slice(1)) {
            const primitiveId = makeSourceId();
            plan.primitiveId = primitiveId;

            const dx = plan.layoutX - template.seed.layoutX;
            const dy = plan.layoutY - template.seed.layoutY;
            const component = cloneSourceRecord(template.component);

            component.outer.id = primitiveId;
            component.outer.ticket = ++ticket;
            component.inner!.x = Number(template.component.inner.x) + dx;
            component.inner!.y = Number(template.component.inner.y) + dy;
            component.inner!.zIndex = ++zIndex;
            appended.push(component);

            for (const attributeTemplate of template.attributes) {
                const attribute = cloneSourceRecord(attributeTemplate);
                if (!attribute.inner) continue;

                attribute.outer.id = makeSourceId();
                attribute.outer.ticket = ++ticket;
                attribute.inner.parentId = primitiveId;

                if (typeof attribute.inner.x === 'number') attribute.inner.x += dx;
                if (typeof attribute.inner.y === 'number') attribute.inner.y += dy;
                updateInstanceAttribute(attribute.inner, plan);
                appended.push(attribute);
            }
        }
    }

    return {
        source: appendDocumentSource(source, appended),
        addedCount: appended.length,
    };
}

async function loadPins(plans: PlannedComponent[]): Promise<void> {
    for (const plan of plans) {
        if (!plan.primitiveId) throw new Error(`Primitive id missing for ${plan.input.designator}`);

        let pins: ISCH_PrimitiveComponentPin[] | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 5; attempt++) {
            try {
                pins = await getPrimitiveComponentPins(plan.primitiveId);
                if (pins.length) break;
            } catch (error) {
                lastError = error;
            }
            await new Promise<void>(resolve => setTimeout(resolve, 50));
        }

        if (!pins?.length) {
            throw new Error(`Pins not loaded for ${plan.input.designator}: ${String(lastError ?? 'empty pin list')}`);
        }
        plan.pins = pins;
    }
}

function splitPinShape(shape?: string): { designator: string; pinNumber: string } | undefined {
    if (!shape) return undefined;
    const marker = shape.lastIndexOf('_pin_');
    if (marker < 0) return undefined;
    return {
        designator: shape.slice(0, marker),
        pinNumber: shape.slice(marker + 5),
    };
}

function findPlan(plans: PlannedComponent[], designator: string, pinNumber: string): PlannedComponent | undefined {
    const exact = plans.filter(plan => plan.input.designator === designator);
    const normalized = exact.length
        ? exact
        : plans.filter(plan => rmPartFromDesignator(plan.input.designator) === rmPartFromDesignator(designator));

    return normalized.find(plan => plan.pins?.some(pin => pin.getState_PinNumber() == pinNumber)) ?? normalized[0];
}

function findPlanPin(plan: PlannedComponent | undefined, pinNumber: string): ISCH_PrimitiveComponentPin | undefined {
    if (!plan?.pins) return undefined;
    const pinName = plan.input.pins.find(pin => pin.pin_number == pinNumber)?.name;
    return plan.pins.find(pin => pin.getState_PinNumber() == pinNumber) ??
        plan.pins.find(pin => pinName && pin.getState_PinName() === pinName);
}

function filterUniqueCoordinatePairs(values: number[]): number[] {
    const result: number[] = [];
    const seen = new Set<string>();
    for (let index = 0; index + 1 < values.length; index += 2) {
        const x = values[index];
        const y = values[index + 1];
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(x, y);
    }
    return result;
}

function orthogonalize(values: number[]): number[] {
    let result = [...values];
    for (let index = 0; index + 3 < result.length; index += 2) {
        if (result[index] === result[index + 2] || result[index + 1] === result[index + 3]) continue;
        const dx = Math.abs(result[index] - result[index + 2]);
        const dy = Math.abs(result[index + 1] - result[index + 3]);
        const bend = dx < dy
            ? [result[index + 2], result[index + 1]]
            : [result[index], result[index + 3]];
        result = [...result.slice(0, index + 2), ...bend, ...result.slice(index + 2)];
    }
    return filterUniqueCoordinatePairs(result);
}

function getSignalName(
    circuit: CircuitAssembly,
    sourceRef: ReturnType<typeof splitPinShape>,
    targetRef: ReturnType<typeof splitPinShape>,
): string {
    for (const ref of [sourceRef, targetRef]) {
        if (!ref) continue;
        const component = circuit.components.find(item => item.designator === ref.designator) ??
            circuit.components.find(item => rmPartFromDesignator(item.designator) === rmPartFromDesignator(ref.designator));
        const signal = component?.pins.find(pin => pin.pin_number == ref.pinNumber)?.signal_name;
        if (signal) return signal;
    }
    return 'unknown net';
}

function pointToWire(point: { x: number; y: number }, offset: Offset): [number, number] {
    const transformed = applyOffset(point.x, point.y, offset);
    return [to2(transformed.x), to2(normWireY(transformed.y))];
}

function buildWireSpecs(
    circuit: CircuitAssembly,
    plans: PlannedComponent[],
    offset: Offset,
): WireSpec[] {
    const specs: WireSpec[] = [];

    for (const edge of circuit.edges) {
        for (const section of edge.sections ?? []) {
            const sourceRef = splitPinShape(section.incomingShape);
            const targetRef = splitPinShape(section.outgoingShape);
            const sourcePlan = sourceRef ? findPlan(plans, sourceRef.designator, sourceRef.pinNumber) : undefined;
            const targetPlan = targetRef ? findPlan(plans, targetRef.designator, targetRef.pinNumber) : undefined;
            const sourcePin = sourceRef ? findPlanPin(sourcePlan, sourceRef.pinNumber) : undefined;
            const targetPin = targetRef ? findPlanPin(targetPlan, targetRef.pinNumber) : undefined;

            const start = sourcePin
                ? [sourcePin.getState_X(), sourcePin.getState_Y()]
                : pointToWire(section.startPoint, offset);
            const end = targetPin
                ? [targetPin.getState_X(), targetPin.getState_Y()]
                : pointToWire(section.endPoint, offset);

            if (!sourcePin && sourceRef) {
                eda.sys_Log.add(`[source-assemble] Pin not found: ${sourceRef.designator} ${sourceRef.pinNumber}`, ESYS_LogType.WARNING);
            }
            if (!targetPin && targetRef) {
                eda.sys_Log.add(`[source-assemble] Pin not found: ${targetRef.designator} ${targetRef.pinNumber}`, ESYS_LogType.WARNING);
            }

            const values = [...start];
            for (const bend of section.bendPoints ?? []) values.push(...pointToWire(bend, offset));
            values.push(...end);

            const normalized = orthogonalize(values.map(value => to2(value)));
            if (normalized.length < 4) continue;

            specs.push({
                values: normalized,
                net: getSignalName(circuit, sourceRef, targetRef),
                description: `${section.incomingShape ?? '?'} -> ${section.outgoingShape ?? '?'}`,
            });
        }
    }

    return specs;
}

function wireSegments(values: number[]): Array<[number, number, number, number]> {
    const segments: Array<[number, number, number, number]> = [];
    for (let index = 0; index + 3 < values.length; index += 2) {
        segments.push([values[index], values[index + 1], values[index + 2], values[index + 3]]);
    }
    return segments;
}

function scoreWireYTransform(
    sourceLine: Record<string, unknown>,
    segment: [number, number, number, number],
    factor: 1 | -1,
): number {
    const [x1, y1, x2, y2] = segment;
    const direct = Math.abs(Number(sourceLine.startX) - x1) +
        Math.abs(Number(sourceLine.startY) - y1 * factor) +
        Math.abs(Number(sourceLine.endX) - x2) +
        Math.abs(Number(sourceLine.endY) - y2 * factor);
    const reverse = Math.abs(Number(sourceLine.startX) - x2) +
        Math.abs(Number(sourceLine.startY) - y2 * factor) +
        Math.abs(Number(sourceLine.endX) - x1) +
        Math.abs(Number(sourceLine.endY) - y1 * factor);
    return Math.min(direct, reverse);
}

async function bulkAddWires(specs: WireSpec[]): Promise<number> {
    if (!specs.length) return 0;

    const seedSpec = specs[0];
    const seedWire = await sch_PrimitiveWireSnap.create(seedSpec.values, seedSpec.net);
    if (!seedWire) throw new Error(`Failed to create seed wire: ${seedSpec.description}`);
    const committed = await seedWire.done();
    const seedPrimitive = committed && typeof committed === 'object' ? committed as ISCH_PrimitiveWire : seedWire;
    const seedId = seedPrimitive.getState_PrimitiveId();
    if (!seedId) throw new Error('Seed wire primitive id is empty');
    if (specs.length === 1) return 1;

    const source = await eda.sys_FileManager.getDocumentSource();
    if (!source) throw new Error('Document source is empty after seed wire placement');
    const records = parseDocumentSource(source);
    const wireTemplate = records.find(record => record.outer.type === 'WIRE' && record.outer.id === seedId);
    const lineTemplates = records.filter(record => record.outer.type === 'LINE' && record.inner?.lineGroup === seedId);
    const attributeTemplates = records.filter(record => record.outer.type === 'ATTR' && record.inner?.parentId === seedId);
    if (!wireTemplate?.inner || !lineTemplates[0]?.inner) throw new Error('Seed wire source template is incomplete');

    const firstSegment = wireSegments(seedSpec.values)[0];
    const yFactor: 1 | -1 = scoreWireYTransform(lineTemplates[0].inner, firstSegment, 1) <=
        scoreWireYTransform(lineTemplates[0].inner, firstSegment, -1) ? 1 : -1;
    let ticket = getMaxTicket(records);
    let zIndex = getMaxZIndex(records);
    const appended: SourceRecord[] = [];

    for (const spec of specs.slice(1)) {
        const wireId = makeSourceId();
        const wire = cloneSourceRecord(wireTemplate);
        wire.outer.id = wireId;
        wire.outer.ticket = ++ticket;
        wire.inner!.zIndex = ++zIndex;
        appended.push(wire);

        for (const [startX, startY, endX, endY] of wireSegments(spec.values)) {
            const line = cloneSourceRecord(lineTemplates[0]);
            line.outer.id = makeSourceId();
            line.outer.ticket = ++ticket;
            line.inner!.lineGroup = wireId;
            line.inner!.startX = startX;
            line.inner!.startY = startY * yFactor;
            line.inner!.endX = endX;
            line.inner!.endY = endY * yFactor;
            appended.push(line);
        }

        const lastX = spec.values.at(-2)!;
        const lastY = spec.values.at(-1)!;
        const previousX = spec.values.at(-4)!;
        for (const attributeTemplate of attributeTemplates) {
            const attribute = cloneSourceRecord(attributeTemplate);
            if (!attribute.inner) continue;
            attribute.outer.id = makeSourceId();
            attribute.outer.ticket = ++ticket;
            attribute.inner.parentId = wireId;
            if (attribute.inner.key === 'NET') {
                attribute.inner.value = spec.net;
                attribute.inner.x = lastX;
                attribute.inner.y = lastY * yFactor;
                attribute.inner.rotation = previousX === lastX ? 90 : 0;
            }
            appended.push(attribute);
        }
    }

    const nextSource = appendDocumentSource(source, appended);
    const applied = await eda.sys_FileManager.setDocumentSource(nextSource);
    if (!applied) throw new Error('EasyEDA rejected bulk wire document source');
    return specs.length;
}

function toPlacedComponents(plans: PlannedComponent[]): PlacedComponents {
    return Object.fromEntries(plans.map(plan => [plan.input.designator, {
        primitive_id: plan.primitiveId!,
        pins: plan.pins!,
        designator: plan.input.designator,
    }]));
}

function getUnusedPinNets(circuit: CircuitAssembly, plans: PlannedComponent[]) {
    const usedPins = new Set<string>();
    for (const edge of circuit.edges) {
        for (const section of edge.sections ?? []) {
            if (section.incomingShape) usedPins.add(section.incomingShape);
            if (section.outgoingShape) usedPins.add(section.outgoingShape);
        }
    }

    return plans.flatMap(plan => plan.input.pins
        .filter(pin => pin.signal_name && pin.signal_name.toLowerCase().trim() !== 'nc')
        .filter(pin => !usedPins.has(`${plan.input.designator}_pin_${pin.pin_number}`))
        .map(pin => ({
            designator: plan.input.designator,
            pin_number: pin.pin_number,
            pin_name: pin.name,
            net: pin.signal_name,
        })));
}

function requiresLegacyAssembler(circuit: CircuitAssembly): string | undefined {
    if (VERSION_EDASYEDA[0] < 3) return 'EasyEDA editor version is older than v3';
    if (circuit.replace_components?.length) return 'replace_components is requested';
    if (circuit.rm_components?.length) return 'rm_components is requested';
    if (circuit.rm_net?.length) return 'rm_net is requested';
    if (circuit.assembly_options?.draw_blocks) return 'draw_blocks is requested';
    return undefined;
}

async function getAssemblyOffset(circuit: CircuitAssembly): Promise<Offset> {
    const root = circuit.blocks_rect?.find(block => block.name.includes('__v_root__')) ?? {
        width: 10,
        height: 10,
    };
    const pageSize = await getPageSize();
    const target = {
        x: (pageSize.width - root.width) / 2,
        y: ((pageSize.height - root.height) / 2) + root.height,
    };
    if (target.x === 0) target.x = 10;
    if (target.y === 0) target.y = 10;
    return searchFreePlaceV2(target, { w: root.width, h: root.height });
}

export async function assembleCircuitSourceTask(
    circuit: CircuitAssembly,
    legacyAssembler: LegacyAssembler,
): Promise<void> {
    const fallbackReason = requiresLegacyAssembler(circuit);
    if (fallbackReason) {
        eda.sys_Log.add(`[source-assemble] Legacy fallback: ${fallbackReason}`, ESYS_LogType.INFO);
        return legacyAssembler(circuit);
    }

    const startedAt = Date.now();
    eda.sys_Message.showToastMessage('Assemble circuit from source...', ESYS_ToastMessageType.INFO);
    eda.sys_Log.add('[source-assemble] Start', ESYS_LogType.INFO);
    const checkpointCreated = Boolean(await eda.checkpointer?.save(true));

    try {
        const offset = await getAssemblyOffset(circuit);
        const plans = planComponents(circuit, offset);
        const groups = groupPlans(plans);
        eda.sys_Log.add(`[source-assemble] ${plans.length} components, ${groups.size} seed variants`);

        await placeSeeds(groups);

        let source = await eda.sys_FileManager.getDocumentSource();
        if (!source) throw new Error('Document source is empty after component seed placement');
        let records = parseDocumentSource(source);
        const templates = collectComponentTemplates(records, groups);
        const componentResult = cloneComponentsIntoSource(source, records, groups, templates);

        if (componentResult.addedCount) {
            const applied = await eda.sys_FileManager.setDocumentSource(componentResult.source);
            if (!applied) throw new Error('EasyEDA rejected bulk component document source');
            source = componentResult.source;
            records = parseDocumentSource(source);
        }

        await loadPins(plans);
        const wireSpecs = buildWireSpecs(circuit, plans, offset);
        const wireCount = await bulkAddWires(wireSpecs);

        sch_PrimitiveWireSnap.invalidate();
        await sch_PrimitiveWireSnap.activate();

        const placedComponents = toPlacedComponents(plans);
        const extraNets = [
            ...(circuit.added_net ?? []),
            ...getUnusedPinNets(circuit, plans),
        ];
        if (extraNets.length) await placeNet(extraNets, placedComponents, true);

        const saved = await eda.sch_Document.save();
        if (!saved) throw new Error('Failed to save source-assembled schematic');

        const duration = Date.now() - startedAt;
        eda.sys_Log.add(
            `[source-assemble] Complete in ${duration}ms: ${plans.length} components (${groups.size} API seeds), ${wireCount} wires`,
            ESYS_LogType.INFO,
        );
        eda.sys_Message.showToastMessage('Assemble complete.', ESYS_ToastMessageType.SUCCESS);
    } catch (error) {
        eda.sys_Log.add(`[source-assemble] Failed: ${(error as Error).message}`, ESYS_LogType.ERROR);
        if (checkpointCreated) {
            const restored = await eda.checkpointer?.restore(undefined, true).catch(() => false);
            if (!restored) eda.sys_Log.add('[source-assemble] Checkpoint rollback failed', ESYS_LogType.ERROR);
        }
        throw error;
    }
}
