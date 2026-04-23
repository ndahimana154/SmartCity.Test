export type SignalValue = boolean;

export type PortMap = Record<string, SignalValue>;

export type ComponentType = 'switch' | 'lightBulb' | 'programmable' | 'trafficLight' | 'trafficController' | 'smartPlc';

export interface Position {
    x: number;
    y: number;
}

export interface SimulationComponent {
    id: string;
    type: ComponentType;
    position: Position;
    rotationY?: number;
    inputs: PortMap;
    outputs: PortMap;
    code?: string;
    lastError?: string;
    plcInstance?: unknown; // SmartPLC instance (to avoid circular dependency)
    update: (inputs: PortMap, component: SimulationComponent) => PortMap;
}

export interface Connection {
    fromComponentId: string;
    toComponentId: string;
    outputKey: string;
    inputKey: string;
}

export interface SimulationState {
    components: SimulationComponent[];
    connections: Connection[];
    tickCount: number;
    timeSeconds: number;
}

export const COMPONENT_SIZE = {
    width: 168,
    headerHeight: 28,
    bodyHeight: 92,
};
