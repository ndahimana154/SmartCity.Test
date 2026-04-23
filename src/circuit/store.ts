import { simulationTick } from './engine';
import type {
    ComponentType,
    Connection,
    PortMap,
    Position,
    SimulationComponent,
    SimulationState,
} from './models';
import { SmartPLC } from '../plc';
import type { SmartPLCConfig } from '../plc';

const DEFAULT_PROGRAM_CODE = `function update(inputs) {
  return { output: inputs.input1 };
}`;

const DEFAULT_CONTROLLER_CODE = `// time = simulated seconds (increments 0.1 per tick, 100 ms/tick)
// Full cycle = 10 s: green 5 s → yellow 1 s → red 4 s
function update(time) {
  const cycle = time % 10;

  if (cycle < 5)  return { green: true,  yellow: false, red: false };
  if (cycle < 6)  return { green: false, yellow: true,  red: false };
  return           { green: false, yellow: false, red: true };
}`;

function createSwitchUpdater() {
    return (_inputs: PortMap, component: SimulationComponent): PortMap => ({
        out: Boolean(component.outputs.out),
    });
}

function createBulbUpdater() {
    return (inputs: PortMap): PortMap => ({
        lit: Boolean(inputs.in),
    });
}

function createProgrammableUpdater() {
    return (_inputs: PortMap, component: SimulationComponent): PortMap => ({
        ...component.outputs,
    });
}

function createSmartPLCUpdater() {
    return (_inputs: PortMap, component: SimulationComponent): PortMap => {
        // SmartPLC outputs are computed during engine tick via plcInstance
        return component.outputs;
    };
}

export function createComponent(type: ComponentType, id: string, position: Position): SimulationComponent {
    if (type === 'switch') {
        return {
            id,
            type,
            position,
            rotationY: 0,
            inputs: {},
            outputs: { out: false },
            update: createSwitchUpdater(),
        };
    }

    if (type === 'lightBulb') {
        return {
            id,
            type,
            position,
            rotationY: 0,
            inputs: { in: false },
            outputs: { lit: false },
            update: createBulbUpdater(),
        };
    }

    if (type === 'trafficLight') {
        return {
            id,
            type,
            position,
            rotationY: 0,
            inputs: { red: false, yellow: false, green: false },
            outputs: {},
            update: (): PortMap => ({}),
        };
    }

    if (type === 'trafficController') {
        return {
            id,
            type,
            position,
            rotationY: 0,
            inputs: {},
            outputs: { red: false, yellow: false, green: false },
            code: DEFAULT_CONTROLLER_CODE,
            update: (_inputs: PortMap, component: SimulationComponent): PortMap => ({ ...component.outputs }),
        };
    }

    if (type === 'smartPlc') {
        // Create minimal default config for a single intersection with basic lights
        const plcConfig = {
            intersections: [
                {
                    id: 'intersection-1',
                    lanes: ['north', 'south', 'east', 'west'],
                    laneToLight: {
                        north: 'north',
                        south: 'south',
                        east: 'east',
                        west: 'west',
                    },
                    phases: [
                        {
                            name: 'NS_GREEN',
                            duration: 5,
                            lights: {
                                north: 'GREEN' as const,
                                south: 'GREEN' as const,
                                east: 'RED' as const,
                                west: 'RED' as const,
                            },
                        },
                        {
                            name: 'NS_YELLOW',
                            duration: 1,
                            lights: {
                                north: 'YELLOW' as const,
                                south: 'YELLOW' as const,
                                east: 'RED' as const,
                                west: 'RED' as const,
                            },
                        },
                        {
                            name: 'EW_GREEN',
                            duration: 5,
                            lights: {
                                north: 'RED' as const,
                                south: 'RED' as const,
                                east: 'GREEN' as const,
                                west: 'GREEN' as const,
                            },
                        },
                        {
                            name: 'EW_YELLOW',
                            duration: 1,
                            lights: {
                                north: 'RED' as const,
                                south: 'RED' as const,
                                east: 'YELLOW' as const,
                                west: 'YELLOW' as const,
                            },
                        },
                    ],
                } as const,
            ],
            busPriority: {
                enabled: true,
                busLanes: ['north', 'south'],
                minGreenExtension: 2,
                maxGreenExtension: 5,
                cooldownAfterBus: 10,
                starvationGuardSeconds: 30,
            },
            emergencyPreemption: {
                enabled: true,
                emergencyLanes: ['all'],
                clearTime: 3,
                postPreemptionPhase: 'GREEN' as const,
            },
            timingParameters: {
                minGreenTime: 2,
                maxGreenTime: 8,
                yellowTime: 1,
                defaultRedTime: 4,
                timePerVehicle: 0.5,
                baseGreenTime: 5,
                peakMorningStart: 7,
                peakMorningEnd: 9,
                peakEveningStart: 17,
                peakEveningEnd: 19,
            },
            sensors: {
                queueDetectors: [],
                busDetectors: [],
                emergencyDetectors: [],
            },
        } as SmartPLCConfig;

        const plc = new SmartPLC(id, plcConfig);
        return {
            id,
            type,
            position,
            rotationY: 0,
            inputs: {},
            outputs: {
                'north_RED': false,
                'north_YELLOW': false,
                'north_GREEN': false,
                'south_RED': false,
                'south_YELLOW': false,
                'south_GREEN': false,
                'east_RED': false,
                'east_YELLOW': false,
                'east_GREEN': false,
                'west_RED': false,
                'west_YELLOW': false,
                'west_GREEN': false,
            },
            plcInstance: plc,
            update: createSmartPLCUpdater(),
        };
    }

    return {
        id,
        type: 'programmable',
        position,
        rotationY: 0,
        inputs: { input1: false },
        outputs: { output: false },
        code: DEFAULT_PROGRAM_CODE,
        update: createProgrammableUpdater(),
    };
}

export function getInputKeys(component: SimulationComponent): string[] {
    return Object.keys(component.inputs);
}

export function getOutputKeys(component: SimulationComponent): string[] {
    return Object.keys(component.outputs);
}

export type StoreAction =
    | { type: 'add-component'; componentType: ComponentType; position: Position }
    | { type: 'move-component'; id: string; position: Position }
    | { type: 'rotate-component'; id: string; rotationY: number }
    | { type: 'delete-component'; id: string }
    | { type: 'toggle-switch'; id: string }
    | { type: 'set-program-code'; id: string; code: string }
    | { type: 'add-connection'; connection: Connection }
    | { type: 'tick' };

function addConnectionIfValid(state: SimulationState, connection: Connection): SimulationState {
    const exists = state.connections.some(
        (item) =>
            item.fromComponentId === connection.fromComponentId &&
            item.toComponentId === connection.toComponentId &&
            item.outputKey === connection.outputKey &&
            item.inputKey === connection.inputKey,
    );

    if (exists || connection.fromComponentId === connection.toComponentId) {
        return state;
    }

    return {
        ...state,
        connections: [...state.connections, connection],
    };
}

export function createInitialState(): SimulationState {
    return {
        components: [],
        connections: [],
        tickCount: 0,
        timeSeconds: 0,
    };
}

export function simulationReducer(state: SimulationState, action: StoreAction): SimulationState {
    if (action.type === 'add-component') {
        const id = `${action.componentType}-${crypto.randomUUID().slice(0, 8)}`;
        const next = createComponent(action.componentType, id, action.position);

        return {
            ...state,
            components: [...state.components, next],
        };
    }

    if (action.type === 'move-component') {
        return {
            ...state,
            components: state.components.map((component) =>
                component.id === action.id ? { ...component, position: action.position } : component,
            ),
        };
    }

    if (action.type === 'rotate-component') {
        return {
            ...state,
            components: state.components.map((component) =>
                component.id === action.id ? { ...component, rotationY: action.rotationY } : component,
            ),
        };
    }

    if (action.type === 'delete-component') {
        return {
            ...state,
            components: state.components.filter((component) => component.id !== action.id),
            connections: state.connections.filter(
                (connection) =>
                    connection.fromComponentId !== action.id && connection.toComponentId !== action.id,
            ),
        };
    }

    if (action.type === 'toggle-switch') {
        return {
            ...state,
            components: state.components.map((component) => {
                if (component.id !== action.id || component.type !== 'switch') {
                    return component;
                }

                return {
                    ...component,
                    outputs: {
                        ...component.outputs,
                        out: !component.outputs.out,
                    },
                };
            }),
        };
    }

    if (action.type === 'set-program-code') {
        return {
            ...state,
            components: state.components.map((component) =>
                component.id === action.id &&
                    (component.type === 'programmable' || component.type === 'trafficController')
                    ? { ...component, code: action.code }
                    : component,
            ),
        };
    }

    if (action.type === 'add-connection') {
        return addConnectionIfValid(state, action.connection);
    }

    if (action.type === 'tick') {
        return simulationTick(state);
    }

    return state;
}
